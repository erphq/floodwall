//! A plane behind a JSON interface, for a host that runs it out of
//! process: Floodwall Cloud runs it compiled to WebAssembly inside a
//! Cloudflare Durable Object, one per plane.
//!
//! [`Host::handle`] takes one request, a JSON object whose `"op"` names
//! what to do, and returns one JSON object. Every answer has `"ok"`; a
//! refusal has `"ok":false`, a `"code"` and an `"error"` sentence. Every
//! answer from an open plane also has `"lines"`: the ledger lines (in the
//! [export format](crate::export), records and the checkpoints they
//! complete, in order) the request wrote, which the host must store, in
//! order, before it acts on the answer. Reopening the plane from those
//! lines (`open` with `"ledger"`) picks up exactly where it left off.
//!
//! Ticks, intent ids and other integers that can pass 2^53 are written as
//! decimal strings, as in the export; a request may give `"now"` as a
//! number or such a string.
//!
//! # Requests
//!
//! - `open`: `capacity`, `checkpoint_every` (or `null`), `signing_seed`
//!   (32 bytes of hex, or `null`: the plane's key for signing
//!   checkpoints), `keyring` (`{"agents":{agent:hex},"retired":{agent:[hex]}}`
//!   or `null`), `settings` (every label the ledger names, and `initial`,
//!   mapped to [settings](#settings)), `initial` (the label the plane was
//!   built under), `ledger` (the lines stored so far, joined with `\n`, or
//!   `""`; the export's header line may be left off), `now`, and
//!   optionally `snapshot` (a string: the text of a snapshot the `snapshot`
//!   op returned, or `null`). With a snapshot, `ledger` holds only the
//!   lines stored after it (the snapshot's own checkpoint line may lead
//!   them), and the plane takes up the snapshot's state and replays only
//!   those lines (see [`crate::snapshot`]); `settings` must then also map
//!   the label the snapshot names. Without one, it replays every line.
//! - `snapshot`: `snapshot`, the plane's state as a snapshot's text (see
//!   [Text form](crate::snapshot#text-form)), taken at the ledger's most
//!   recent checkpoint: if records came after that checkpoint, one is cut
//!   now, and its line is in this answer's `lines`. `null` if the plane has
//!   no checkpoint yet (none is cut unless `checkpoint_every` is set). Store
//!   it with the lines up to its checkpoint; the lines after it are all a
//!   later `open` needs with it.
//! - `submit`: `intent` (in the export's intent form), `now`. The intent is
//!   offered, and if it gets in a pass runs at once: `accepted`, `refused`
//!   (why not), `report`. An intent a model reviewed carries its `review`
//!   object in that form too (see [`crate::export`]); the gate adds it to
//!   the breakdown as `ai-review` (see [AI review](crate::gate#ai-review)).
//! - `tick`: `now`. `report`.
//! - `release` / `expire`: `agent`, `id`, `by`, `now`. A release is followed
//!   by a pass: `report`.
//! - `complete`: `agent`, `id`, `outcome` (`"succeeded"` or `"failed"`),
//!   `reason` (or `null`), `now`.
//! - `reconfigure`: `label`, `settings`, `now` (see [`crate::reconfigure`]).
//! - `keyring`: `keyring`. Replaces the keyring.
//! - `state`: the queue, what is in flight and what is held, the clock, the
//!   ledger's length (every record, before a snapshot too) and head, and
//!   the stats in Prometheus text.
//! - `dry_run`: `settings`, `intents`. Each intent's gate decision under
//!   those settings; needs no open plane and changes nothing.
//! - `normalize_settings`: `settings`. The same settings with every default
//!   written out (`settings`, an object), so settings stored in that form
//!   mean the same to a later release whose defaults differ. Needs no open
//!   plane; the answer is accepted back as it is.
//! - `keys`: the keys auditors check the ledger with (see
//!   [`keys_json`](crate::export::keys_json)).
//! - `verify`: whether the ledger verifies, and how many checkpoints carry
//!   the plane's signature. A plane opened from a snapshot verifies the
//!   lines after it, from its checkpoint.
//!
//! # Settings
//!
//! ```text
//! {"rules":"<rules file>"|"",
//!  "burst":8,"refill_millis":1000,
//!  "default_limit":1,"limits":{"web":2},"conflict_window":0,
//!  "lease":null|{"kind":"report"|"fail","ticks":30},
//!  "aging":null|{"every":60,"up_to":"urgent"},
//!  "hold_capacity":1024,"hold_ttl":null|86400}
//! ```
//!
//! Every key is optional, with the crate's defaults (no rules, a burst of
//! 8, refilling 1 a tick). `refill_millis` is thousandths of an intent per
//! tick.

use std::collections::BTreeMap;

use crate::export::{
    checkpoint_line, decimal, hex, intent_json, json_str, read_intent, record_line,
};
use crate::intent::{IntentKey, Priority};
use crate::json::{self, Value};
use crate::reconfigure::Settings;
use crate::{
    Aging, Floodwall, Gate, HoldConfig, Keyring, Lease, Ledger, Outcome, RateLimit, Rejected,
    SchedulerConfig, SigningKey, Snapshot, TickReport, VerifyingKey,
};

/// A plane and what of its ledger the host has been given.
#[derive(Default)]
pub struct Host {
    plane: Option<Floodwall>,
    /// Ledger records the host already has.
    records_out: usize,
    /// Checkpoints the host already has.
    checkpoints_out: usize,
}

/// A refusal: a short code and a sentence.
struct Refusal(&'static str, String);

fn bad(message: impl Into<String>) -> Refusal {
    Refusal("bad_request", message.into())
}

type Answer = Result<String, Refusal>;

impl Host {
    /// A host with no plane open.
    pub fn new() -> Self {
        Self::default()
    }

    /// Answer one request (see [the module docs](self)).
    pub fn handle(&mut self, request: &str) -> String {
        let answer = json::parse(request)
            .map_err(|e| bad(format!("the request is not JSON: {e}")))
            .and_then(|value| self.dispatch(&value));
        match answer {
            Ok(fields) => {
                let mut out = String::from("{\"ok\":true");
                out.push_str(&fields);
                if self.plane.is_some() {
                    out.push_str(",\"lines\":");
                    out.push_str(&self.new_lines());
                }
                out.push('}');
                out
            }
            Err(Refusal(code, message)) => {
                let mut out = String::from("{\"ok\":false,\"code\":");
                json_str(&mut out, code);
                out.push_str(",\"error\":");
                json_str(&mut out, &message);
                out.push('}');
                out
            }
        }
    }

    fn plane(&mut self) -> Result<&mut Floodwall, Refusal> {
        self.plane
            .as_mut()
            .ok_or_else(|| Refusal("not_open", "no plane is open".into()))
    }

    fn dispatch(&mut self, request: &Value) -> Answer {
        let op = string(get(request, "op")?, "op")?;
        match op {
            "open" => self.open(request),
            "submit" => {
                let intent = read_intent(get(request, "intent")?).map_err(bad)?;
                let now = tick(get(request, "now")?)?;
                let key = intent.key();
                let plane = self.plane()?;
                let mut out = String::new();
                out.push_str(",\"key\":");
                key_json(&mut out, &key);
                match plane.submit(intent, now) {
                    Ok(()) => {
                        let report = plane.tick(now);
                        out.push_str(",\"accepted\":true,\"refused\":null,\"report\":");
                        report_json(&mut out, &report);
                    }
                    Err(why) => {
                        out.push_str(",\"accepted\":false,\"refused\":");
                        json_str(&mut out, rejected_label(&why));
                        out.push_str(",\"report\":null");
                    }
                }
                Ok(out)
            }
            "tick" => {
                let now = tick(get(request, "now")?)?;
                let report = self.plane()?.tick(now);
                let mut out = String::from(",\"report\":");
                report_json(&mut out, &report);
                Ok(out)
            }
            "release" | "expire" => {
                let key = intent_key(request)?;
                let by = string(get(request, "by")?, "by")?.to_string();
                let now = tick(get(request, "now")?)?;
                let plane = self.plane()?;
                if op == "release" {
                    plane
                        .release(&key, &by, now)
                        .map_err(|e| Refusal("refused", e.to_string()))?;
                    let report = plane.tick(now);
                    let mut out = String::from(",\"report\":");
                    report_json(&mut out, &report);
                    Ok(out)
                } else {
                    plane
                        .expire(&key, &by, now)
                        .map_err(|e| Refusal("refused", e.to_string()))?;
                    Ok(String::new())
                }
            }
            "complete" => {
                let key = intent_key(request)?;
                let now = tick(get(request, "now")?)?;
                let outcome = match string(get(request, "outcome")?, "outcome")? {
                    "succeeded" => Outcome::Succeeded,
                    "failed" => Outcome::Failed(match get(request, "reason")? {
                        Value::Null => String::new(),
                        v => string(v, "reason")?.to_string(),
                    }),
                    _ => return Err(bad("outcome is not \"succeeded\" or \"failed\"")),
                };
                self.plane()?
                    .complete(&key, outcome, now)
                    .map_err(|e| Refusal("refused", e.to_string()))?;
                Ok(String::new())
            }
            "reconfigure" => {
                let label = string(get(request, "label")?, "label")?.to_string();
                let settings = read_settings(get(request, "settings")?)?;
                let now = tick(get(request, "now")?)?;
                self.plane()?
                    .reconfigure(settings, &label, now)
                    .map_err(|e| bad(e.to_string()))?;
                Ok(String::new())
            }
            "keyring" => {
                let keyring = read_keyring(get(request, "keyring")?)?;
                let plane = self
                    .plane
                    .take()
                    .ok_or_else(|| Refusal("not_open", "no plane is open".into()))?;
                self.plane = Some(match keyring {
                    Some(keyring) => plane.with_keyring(keyring),
                    None => plane,
                });
                Ok(String::new())
            }
            "state" => Ok(self.state()?),
            "snapshot" => {
                let plane = self.plane()?;
                if plane.ledger().checkpoints().is_empty() {
                    return Ok(",\"snapshot\":null".into());
                }
                // At a call's end, so a checkpoint cut now has a state.
                plane.checkpoint();
                let snapshot = plane
                    .snapshot()
                    .expect("the checkpoint just cut covers every record");
                let mut out = String::from(",\"snapshot\":");
                json_str(&mut out, &snapshot.to_json());
                Ok(out)
            }
            "dry_run" => {
                let settings = read_settings(get(request, "settings")?)?;
                let Value::Array(intents) = get(request, "intents")? else {
                    return Err(bad("intents is not an array"));
                };
                let mut out = String::from(",\"decisions\":[");
                for (i, value) in intents.iter().enumerate() {
                    let intent =
                        read_intent(value).map_err(|e| bad(format!("intents[{i}]: {e}")))?;
                    let decision = settings.gate.evaluate(&intent);
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str("{\"key\":");
                    key_json(&mut out, &intent.key());
                    out.push_str(",\"verdict\":");
                    json_str(&mut out, decision.verdict.label());
                    out.push_str(",\"reason\":");
                    opt_str(&mut out, decision.verdict.reason());
                    out.push_str(",\"policies\":");
                    breakdown_json(&mut out, &decision.breakdown);
                    out.push('}');
                }
                out.push(']');
                Ok(out)
            }
            "normalize_settings" => {
                let value = get(request, "settings")?;
                let settings = read_settings(value)?;
                let mut out = String::from(",\"settings\":");
                normalized_settings(&mut out, value, &settings);
                Ok(out)
            }
            "keys" => {
                let plane = self.plane()?;
                let empty = Keyring::new();
                let keys = crate::export::keys_json(
                    plane.keyring().unwrap_or(&empty),
                    plane.ledger().signer().as_ref(),
                );
                Ok(format!(",\"keys\":{keys}"))
            }
            "verify" => {
                let plane = self.plane()?;
                let ledger = plane.ledger();
                let signed = match ledger.signer() {
                    Some(key) => ledger.verify_checkpoint_signatures(&key).map_or_else(
                        |at| format!("{{\"checked\":{at},\"failed_at\":{at}}}"),
                        |n| format!("{{\"checked\":{n},\"failed_at\":null}}"),
                    ),
                    None => "null".into(),
                };
                Ok(format!(
                    ",\"verified\":{},\"records\":{},\"checkpoints\":{},\"signed_checkpoints\":{signed}",
                    ledger.verify(),
                    ledger.size(),
                    ledger.checkpoints().len()
                ))
            }
            other => Err(bad(format!("unknown op {other:?}"))),
        }
    }

    fn open(&mut self, request: &Value) -> Answer {
        if self.plane.is_some() {
            return Err(Refusal("already_open", "a plane is already open".into()));
        }
        let capacity = count(get(request, "capacity")?, "capacity")?;
        let Value::Object(settings) = get(request, "settings")? else {
            return Err(bad("settings is not an object"));
        };
        let settings: BTreeMap<&str, &Value> =
            settings.iter().map(|(k, v)| (k.as_str(), v)).collect();
        let initial = string(get(request, "initial")?, "initial")?;
        let first = read_settings(
            settings
                .get(initial)
                .ok_or_else(|| bad(format!("settings has no {initial:?}")))?,
        )?;
        let now = tick(get(request, "now")?)?;

        let text = string(get(request, "ledger")?, "ledger")?;
        let snapshot = match get(request, "snapshot") {
            Err(_) | Ok(Value::Null) => None,
            Ok(v) => Some(
                Snapshot::from_json(string(v, "snapshot")?)
                    .map_err(|e| bad(format!("snapshot: {e}")))?,
            ),
        };
        let mut ledger = if let Some(snapshot) = &snapshot {
            // The lines after the snapshot's checkpoint, as the host stored
            // them.
            let mut lines = String::with_capacity(text.len() + 1);
            lines.push_str(text);
            if !lines.is_empty() && !lines.ends_with('\n') {
                lines.push('\n');
            }
            snapshot
                .read_tail(lines.as_bytes())
                .map_err(|e| bad(format!("ledger: {e}")))?
        } else if text.is_empty() {
            Ledger::new()
        } else {
            // The host stores the lines it was given; the header and the
            // final newline are the export's framing.
            let mut framed = String::with_capacity(text.len() + 256);
            if !text.starts_with("{\"type\":\"header\"") {
                framed.push_str(&crate::export::header(0));
                framed.push('\n');
            }
            framed.push_str(text);
            if !framed.ends_with('\n') {
                framed.push('\n');
            }
            Ledger::read_jsonl(framed.as_bytes()).map_err(|e| bad(format!("ledger: {e}")))?
        };
        match get(request, "checkpoint_every")? {
            Value::Null => {}
            v => {
                let every = count(v, "checkpoint_every")?;
                if every == 0 {
                    return Err(bad("checkpoint_every must be at least 1"));
                }
                ledger = ledger.with_checkpoints(every as u64);
            }
        }
        match get(request, "signing_seed")? {
            Value::Null => {}
            v => {
                ledger = ledger.with_signer(SigningKey::from_seed(
                    &hex::<32>(v, "signing_seed").map_err(bad)?,
                ))
            }
        }
        let stored_records = ledger.len();
        let stored_checkpoints = ledger.checkpoints().len();

        if first.rate_limit.validate().is_err() {
            return Err(bad("the initial settings' rate limit is invalid"));
        }
        let mut plane = first.build(capacity).with_settings_label(initial);
        if let Some(keyring) = read_keyring(get(request, "keyring")?)? {
            plane = plane.with_keyring(keyring);
        }
        let named = |label: &str| settings.get(label).and_then(|v| read_settings(v).ok());
        let plane = match &snapshot {
            Some(snapshot) => plane.resume_from_snapshot(snapshot, ledger, now, named),
            None if ledger.is_empty() => {
                let mut plane = plane.with_ledger(ledger);
                plane.tick(now);
                Ok(plane)
            }
            None => plane.resume_with(ledger, now, named),
        }
        .map_err(|e| Refusal("cannot_resume", e.to_string()))?;
        self.records_out = stored_records;
        self.checkpoints_out = stored_checkpoints;
        self.plane = Some(plane);
        Ok(String::new())
    }

    fn state(&mut self) -> Answer {
        let plane = self.plane()?;
        let mut out = String::from(",\"clock\":");
        json_str(&mut out, &plane.clock().to_string());
        out.push_str(",\"queued\":[");
        for (i, intent) in plane.queued().enumerate() {
            if i > 0 {
                out.push(',');
            }
            intent_json(&mut out, intent);
        }
        out.push_str("],\"in_flight\":[");
        for (i, f) in plane.in_flight().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str("{\"intent\":");
            intent_json(&mut out, &f.intent);
            out.push_str(",\"since\":");
            json_str(&mut out, &f.since.to_string());
            out.push('}');
        }
        out.push_str("],\"held\":[");
        for (i, h) in plane.held().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str("{\"intent\":");
            intent_json(&mut out, &h.intent);
            out.push_str(",\"since\":");
            json_str(&mut out, &h.since.to_string());
            out.push_str(",\"reason\":");
            json_str(&mut out, &h.reason);
            out.push('}');
        }
        out.push_str("],\"ledger\":{\"records\":");
        out.push_str(&plane.ledger().size().to_string());
        out.push_str(",\"head\":");
        json_str(&mut out, &plane.ledger().head().to_string());
        out.push_str("},\"prometheus\":");
        json_str(&mut out, &plane.stats().prometheus());
        Ok(out)
    }

    /// The ledger lines written since the host was last given any, as a
    /// JSON array of strings.
    fn new_lines(&mut self) -> String {
        let Some(plane) = &self.plane else {
            return "[]".into();
        };
        let ledger = plane.ledger();
        let checkpoints = ledger.checkpoints();
        let mut out = String::from("[");
        let mut first = true;
        let mut push = |out: &mut String, line: &str| {
            if !first {
                out.push(',');
            }
            first = false;
            json_str(out, line);
        };
        let mut cp = self.checkpoints_out;
        let held = self.records_out.min(ledger.len());
        // A checkpoint cut with no record since, as `snapshot` cuts one.
        let at = ledger.size() - (ledger.len() - held) as u64;
        while let Some(c) = checkpoints.get(cp).filter(|c| c.size == at) {
            push(&mut out, &checkpoint_line(c));
            cp += 1;
        }
        for record in &ledger.records()[held..] {
            push(&mut out, &record_line(record));
            while let Some(c) = checkpoints.get(cp) {
                if c.size != record.seq + 1 {
                    break;
                }
                push(&mut out, &checkpoint_line(c));
                cp += 1;
            }
        }
        out.push(']');
        self.records_out = ledger.len();
        self.checkpoints_out = cp;
        out
    }
}

fn get<'a>(value: &'a Value, name: &str) -> Result<&'a Value, Refusal> {
    let Value::Object(fields) = value else {
        return Err(bad("the request is not an object"));
    };
    fields
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, v)| v)
        .ok_or_else(|| bad(format!("{name} is missing")))
}

fn string<'a>(value: &'a Value, what: &str) -> Result<&'a str, Refusal> {
    match value {
        Value::String(s) => Ok(s),
        other => Err(bad(format!("{what} is {}, not a string", other.kind()))),
    }
}

fn count(value: &Value, what: &str) -> Result<usize, Refusal> {
    match value {
        Value::Number(n) => usize::try_from(*n).map_err(|_| bad(format!("{what} is too large"))),
        other => Err(bad(format!("{what} is {}, not a number", other.kind()))),
    }
}

/// A tick, as a number or a decimal string.
fn tick(value: &Value) -> Result<u64, Refusal> {
    match value {
        Value::Number(n) => Ok(*n),
        other => decimal(other, "now").map_err(bad),
    }
}

fn intent_key(request: &Value) -> Result<IntentKey, Refusal> {
    let agent = string(get(request, "agent")?, "agent")?;
    let id = decimal(get(request, "id")?, "id").map_err(bad)?;
    Ok(IntentKey::new(agent, id))
}

fn read_keyring(value: &Value) -> Result<Option<Keyring>, Refusal> {
    if matches!(value, Value::Null) {
        return Ok(None);
    }
    let key = |v: &Value, what: &str| -> Result<VerifyingKey, Refusal> {
        VerifyingKey::from_bytes(&hex::<32>(v, what).map_err(bad)?)
            .map_err(|_| bad(format!("{what} is not an Ed25519 public key")))
    };
    let mut keyring = Keyring::new();
    let Value::Object(agents) = get(value, "agents")? else {
        return Err(bad("keyring.agents is not an object"));
    };
    for (agent, v) in agents {
        keyring.insert(agent.clone(), key(v, &format!("keyring.agents.{agent}"))?);
    }
    if let Ok(Value::Object(retired)) = get(value, "retired") {
        for (agent, list) in retired {
            let Value::Array(list) = list else {
                return Err(bad(format!("keyring.retired.{agent} is not an array")));
            };
            for v in list {
                keyring = keyring
                    .with_retired(agent.clone(), key(v, &format!("keyring.retired.{agent}"))?);
            }
        }
    }
    Ok(Some(keyring))
}

/// Settings from their JSON form (see [Settings](self#settings)).
fn read_settings(value: &Value) -> Result<Settings, Refusal> {
    const KEYS: [&str; 11] = [
        "rules",
        "burst",
        "refill_millis",
        "default_limit",
        "limits",
        "conflict_window",
        "lease",
        "aging",
        "hold_capacity",
        "hold_ttl",
        "_",
    ];
    let Value::Object(fields) = value else {
        return Err(bad("settings is not an object"));
    };
    if let Some((key, _)) = fields
        .iter()
        .find(|(k, _)| !KEYS[..10].contains(&k.as_str()))
    {
        return Err(bad(format!("settings has an unknown field {key:?}")));
    }
    let field = |name: &str| fields.iter().find(|(k, _)| k == name).map(|(_, v)| v);
    let number = |name: &str, default: u64| -> Result<u64, Refusal> {
        match field(name) {
            None => Ok(default),
            Some(Value::Number(n)) => Ok(*n),
            Some(other) => Err(bad(format!(
                "settings.{name} is {}, not a number",
                other.kind()
            ))),
        }
    };

    let gate = match field("rules") {
        None => Gate::new(),
        Some(v) => {
            let text = string(v, "settings.rules")?;
            if text.trim().is_empty() {
                Gate::new()
            } else {
                Gate::new()
                    .with_rules(text)
                    .map_err(|e| Refusal("bad_rules", e.to_string()))?
            }
        }
    };
    let rate_limit = RateLimit::try_new(
        number("burst", 8)? as f64,
        number("refill_millis", 1000)? as f64 / 1000.0,
    )
    .map_err(|e| bad(e.to_string()))?;

    let mut scheduler =
        SchedulerConfig::default().with_conflict_window(number("conflict_window", 0)?);
    if field("default_limit").is_some() {
        let limit = number("default_limit", 1)? as usize;
        if limit == 0 {
            return Err(bad("settings.default_limit must be at least 1"));
        }
        scheduler = scheduler.with_default_limit(limit);
    }
    if let Some(v) = field("limits") {
        let Value::Object(limits) = v else {
            return Err(bad("settings.limits is not an object"));
        };
        for (resource, n) in limits {
            let n = count(n, &format!("settings.limits.{resource}"))?;
            if n == 0 {
                return Err(bad(format!(
                    "settings.limits.{resource} must be at least 1"
                )));
            }
            scheduler = scheduler.with_limit(resource.clone(), n);
        }
    }
    match field("lease") {
        None | Some(Value::Null) => {}
        Some(v) => {
            let ticks = match get(v, "ticks")? {
                Value::Number(n) if *n > 0 => *n,
                _ => return Err(bad("settings.lease.ticks must be a number above 0")),
            };
            let lease = match string(get(v, "kind")?, "settings.lease.kind")? {
                "report" => Lease::Report(ticks),
                "fail" => Lease::Fail(ticks),
                _ => return Err(bad("settings.lease.kind is not \"report\" or \"fail\"")),
            };
            scheduler = scheduler.with_lease(Some(lease));
        }
    }
    match field("aging") {
        None | Some(Value::Null) => {}
        Some(v) => {
            let every = match get(v, "every")? {
                Value::Number(n) if *n > 0 => *n,
                _ => return Err(bad("settings.aging.every must be a number above 0")),
            };
            let up_to = priority(string(get(v, "up_to")?, "settings.aging.up_to")?)?;
            scheduler = scheduler.with_aging(Some(Aging::new(every, up_to)));
        }
    }

    let mut hold = HoldConfig::default();
    if field("hold_capacity").is_some() {
        hold = hold.with_capacity(number("hold_capacity", 0)? as usize);
    }
    match field("hold_ttl") {
        None | Some(Value::Null) => {}
        Some(Value::Number(n)) => hold = hold.with_ttl(Some(*n)),
        Some(other) => {
            return Err(bad(format!(
                "settings.hold_ttl is {}, not a number",
                other.kind()
            )))
        }
    }
    Ok(Settings {
        gate,
        rate_limit,
        scheduler,
        hold,
    })
}

/// `value` (settings [`read_settings`] took as `settings`) with every
/// default written out, keys in order.
fn normalized_settings(out: &mut String, value: &Value, settings: &Settings) {
    let field = |name: &str| match value {
        Value::Object(fields) => fields.iter().find(|(k, _)| k == name).map(|(_, v)| v),
        _ => None,
    };
    let number = |name: &str, default: u64| match field(name) {
        Some(Value::Number(n)) => *n,
        _ => default,
    };
    out.push_str("{\"aging\":");
    match settings.scheduler.aging() {
        Some(aging) => {
            out.push_str(&format!("{{\"every\":{},\"up_to\":", aging.every()));
            json_str(out, priority_label(aging.up_to()));
            out.push('}');
        }
        None => out.push_str("null"),
    }
    out.push_str(&format!(
        ",\"burst\":{},\"conflict_window\":{},\"default_limit\":{},\"hold_capacity\":{},\"hold_ttl\":",
        number("burst", 8),
        settings.scheduler.conflict_window(),
        settings.scheduler.default_limit(),
        settings.hold.capacity(),
    ));
    match settings.hold.ttl() {
        Some(ttl) => out.push_str(&ttl.to_string()),
        None => out.push_str("null"),
    }
    out.push_str(",\"lease\":");
    match settings.scheduler.lease() {
        Some(Lease::Report(ticks)) => {
            out.push_str(&format!("{{\"kind\":\"report\",\"ticks\":{ticks}}}"))
        }
        Some(Lease::Fail(ticks)) => {
            out.push_str(&format!("{{\"kind\":\"fail\",\"ticks\":{ticks}}}"))
        }
        None => out.push_str("null"),
    }
    out.push_str(",\"limits\":{");
    // Later keys win, as in read_settings.
    let mut limits: BTreeMap<&str, u64> = BTreeMap::new();
    if let Some(Value::Object(given)) = field("limits") {
        for (resource, n) in given {
            if let Value::Number(n) = n {
                limits.insert(resource.as_str(), *n);
            }
        }
    }
    for (i, (resource, n)) in limits.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        json_str(out, resource);
        out.push_str(&format!(":{n}"));
    }
    out.push_str(&format!(
        "}},\"refill_millis\":{},\"rules\":",
        number("refill_millis", 1000)
    ));
    match field("rules") {
        Some(Value::String(rules)) => json_str(out, rules),
        _ => out.push_str("\"\""),
    }
    out.push('}');
}

fn priority_label(p: Priority) -> &'static str {
    match p {
        Priority::Bulk => "bulk",
        Priority::Normal => "normal",
        Priority::Urgent => "urgent",
        Priority::Pager => "pager",
    }
}

fn priority(s: &str) -> Result<Priority, Refusal> {
    Ok(match s {
        "bulk" => Priority::Bulk,
        "normal" => Priority::Normal,
        "urgent" => Priority::Urgent,
        "pager" => Priority::Pager,
        _ => return Err(bad(format!("{s:?} is not bulk, normal, urgent or pager"))),
    })
}

fn rejected_label(why: &Rejected) -> &'static str {
    match why {
        Rejected::RateLimited => "rate_limited",
        Rejected::Backpressure => "backpressure",
        Rejected::Duplicate => "duplicate",
        Rejected::Unsigned => "unsigned",
        Rejected::UnknownAgent => "unknown_agent",
        Rejected::BadSignature => "bad_signature",
    }
}

fn opt_str(out: &mut String, s: Option<&str>) {
    match s {
        Some(s) => json_str(out, s),
        None => out.push_str("null"),
    }
}

fn key_json(out: &mut String, key: &IntentKey) {
    out.push_str("{\"agent\":");
    json_str(out, key.agent.as_str());
    out.push_str(",\"id\":");
    json_str(out, &key.id.to_string());
    out.push('}');
}

fn breakdown_json(out: &mut String, breakdown: &[(String, crate::Verdict)]) {
    out.push('[');
    for (i, (name, verdict)) in breakdown.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"policy\":");
        json_str(out, name);
        out.push_str(",\"verdict\":");
        json_str(out, verdict.label());
        out.push_str(",\"reason\":");
        opt_str(out, verdict.reason());
        out.push('}');
    }
    out.push(']');
}

fn report_json(out: &mut String, report: &TickReport) {
    out.push_str("{\"decisions\":[");
    for (i, d) in report.decisions.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"key\":");
        key_json(out, &d.intent.key());
        out.push_str(",\"verdict\":");
        json_str(out, d.verdict.label());
        out.push_str(",\"reason\":");
        opt_str(out, d.verdict.reason());
        out.push_str(",\"policies\":");
        breakdown_json(out, &d.breakdown);
        out.push_str(",\"released_by\":");
        opt_str(out, d.released_by.as_deref());
        out.push('}');
    }
    out.push_str("],\"expired\":[");
    for (i, h) in report.expired.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        key_json(out, &h.intent.key());
    }
    for (name, list) in [("overdue", &report.overdue), ("lapsed", &report.lapsed)] {
        out.push_str("],\"");
        out.push_str(name);
        out.push_str("\":[");
        for (i, f) in list.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            key_json(out, &f.intent.key());
        }
    }
    out.push_str("]}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(agent: &str, id: u64, resource: &str) -> String {
        format!(
            "{{\"id\":\"{id}\",\"agent\":\"{agent}\",\"action\":{{\"kind\":\"scale\",\"resource\":\"{resource}\",\"replicas\":2}},\"priority\":\"normal\",\"blast_radius\":\"service\",\"signature\":null}}"
        )
    }

    const ALLOW_WEB: &str = "format 1\\npolicy \\\"allow\\\" {\\n  defer \\\"not on the list\\\" when resource not in [\\\"web\\\"]\\n}\\n";

    fn open(ledger: &str) -> String {
        format!(
            "{{\"op\":\"open\",\"capacity\":64,\"checkpoint_every\":2,\"signing_seed\":\"{}\",\"keyring\":null,\
             \"settings\":{{\"v1\":{{\"rules\":\"{ALLOW_WEB}\"}},\"v2\":{{\"burst\":2}}}},\"initial\":\"v1\",\
             \"ledger\":{},\"now\":\"0\"}}",
            "07".repeat(32),
            {
                let mut s = String::new();
                json_str(&mut s, ledger);
                s
            }
        )
    }

    fn lines(answer: &str) -> Vec<String> {
        let v = json::parse(answer).unwrap();
        let Ok(Value::Array(lines)) = get(&v, "lines") else {
            panic!("no lines in {answer}")
        };
        lines
            .iter()
            .map(|l| match l {
                Value::String(s) => s.clone(),
                _ => panic!(),
            })
            .collect()
    }

    fn field(answer: &str, path: &[&str]) -> Value {
        let mut v = json::parse(answer).unwrap();
        for name in path {
            v = get(&v, name)
                .ok()
                .unwrap_or_else(|| panic!("no {name} in {answer}"))
                .clone();
        }
        v
    }

    /// `open`, from `snapshot` and the lines after it.
    fn open_from(snapshot: &str, ledger: &str) -> String {
        let plain = open(ledger);
        let mut field = String::from(",\"snapshot\":");
        json_str(&mut field, snapshot);
        format!("{}{field}}}", &plain[..plain.len() - 1])
    }

    fn snapshot_of(answer: &str) -> String {
        match field(answer, &["snapshot"]) {
            Value::String(s) => s,
            other => panic!("no snapshot but {other:?} in {answer}"),
        }
    }

    /// The same calls on two hosts give the same answers and lines.
    fn both(a: &mut Host, b: &mut Host, request: &str) -> String {
        let (x, y) = (a.handle(request), b.handle(request));
        assert_eq!(x, y, "{request}");
        assert_eq!(field(&x, &["ok"]), Value::Bool(true), "{x}");
        x
    }

    #[test]
    fn normalize_settings_writes_every_default_and_takes_its_answer_back() {
        let mut host = Host::new();
        let answer =
            host.handle(r#"{"op":"normalize_settings","settings":{"limits":{"web":2},"burst":3}}"#);
        let v = json::parse(&answer).unwrap();
        let Ok(settings) = get(&v, "settings") else {
            panic!("no settings in {answer}")
        };
        let mut text = String::new();
        normalized_settings(&mut text, settings, &read_settings(settings).ok().unwrap());
        assert_eq!(
            text,
            r#"{"aging":null,"burst":3,"conflict_window":0,"default_limit":1,"hold_capacity":1024,"hold_ttl":null,"lease":null,"limits":{"web":2},"refill_millis":1000,"rules":""}"#
        );
        let again = host.handle(&format!(
            r#"{{"op":"normalize_settings","settings":{text}}}"#
        ));
        assert_eq!(again, format!(r#"{{"ok":true,"settings":{text}}}"#));
        let bad = host.handle(r#"{"op":"normalize_settings","settings":{"burst":"lots"}}"#);
        assert!(bad.starts_with(r#"{"ok":false"#), "{bad}");
    }

    #[test]
    fn a_plane_reopens_from_a_snapshot_and_the_lines_after_it() {
        let mut host = Host::new();
        let mut stored = Vec::new();
        stored.extend(lines(&host.handle(&open(""))));
        let submit = |id: u64, resource: &str, now: u64| {
            format!(
                "{{\"op\":\"submit\",\"intent\":{},\"now\":{now}}}",
                intent("bot", id, resource)
            )
        };
        for request in [
            submit(1, "web", 1),
            submit(2, "db", 2), // held: not on the list
            "{\"op\":\"reconfigure\",\"label\":\"v2\",\"settings\":{\"burst\":2},\"now\":3}".into(),
            submit(3, "web", 3), // queued behind bot#1
            "{\"op\":\"complete\",\"agent\":\"bot\",\"id\":\"1\",\"outcome\":\"succeeded\",\"reason\":null,\"now\":4}".into(),
        ] {
            stored.extend(lines(&host.handle(&request)));
        }
        // Seven records so far, the last checkpoint at six: the snapshot
        // cuts one at the end.
        let a = host.handle("{\"op\":\"snapshot\"}");
        let new = lines(&a);
        assert_eq!(new.len(), 1, "{new:?}");
        assert!(new[0].contains("\"type\":\"checkpoint\""), "{new:?}");
        stored.extend(new);
        let snapshot = snapshot_of(&a);
        assert!(snapshot.contains("\"settings\":\"v2\""), "{snapshot}");
        // Asked again with nothing new, the same snapshot and no new line.
        let again = host.handle("{\"op\":\"snapshot\"}");
        assert_eq!(snapshot_of(&again), snapshot);
        assert!(lines(&again).is_empty());
        let after = stored.len();

        for request in [
            "{\"op\":\"tick\",\"now\":5}".to_string(),
            "{\"op\":\"release\",\"agent\":\"bot\",\"id\":\"2\",\"by\":\"alice\",\"now\":6}".into(),
        ] {
            stored.extend(lines(&host.handle(&request)));
        }
        let state = plane_state(&mut host);

        // Reopened from the snapshot and only the lines after it.
        let tail = stored[after..].join("\n");
        let mut reopened = Host::new();
        let a = reopened.handle(&open_from(&snapshot, &tail));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        assert!(lines(&a).is_empty());
        assert_eq!(plane_state(&mut reopened), state);
        let verify = reopened.handle("{\"op\":\"verify\"}");
        assert_eq!(field(&verify, &["verified"]), Value::Bool(true), "{verify}");
        assert_eq!(field(&verify, &["records"]), Value::Number(10));
        assert_eq!(
            field(&verify, &["signed_checkpoints", "failed_at"]),
            Value::Null,
            "{verify}"
        );
        // The snapshot's own checkpoint line may lead the tail.
        let mut led = Host::new();
        let a = led.handle(&open_from(&snapshot, &stored[after - 1..].join("\n")));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        assert_eq!(plane_state(&mut led), state);

        // It keeps working exactly as the plane that never stopped.
        for request in [
            submit(4, "web", 7),
            "{\"op\":\"tick\",\"now\":8}".into(),
            "{\"op\":\"complete\",\"agent\":\"bot\",\"id\":\"3\",\"outcome\":\"failed\",\"reason\":\"no\",\"now\":9}".into(),
            "{\"op\":\"snapshot\"}".into(),
            "{\"op\":\"keys\"}".into(),
        ] {
            both(&mut host, &mut reopened, &request);
        }
        assert_eq!(plane_state(&mut reopened), plane_state(&mut host));
        let verify = reopened.handle("{\"op\":\"verify\"}");
        assert_eq!(field(&verify, &["verified"]), Value::Bool(true), "{verify}");
        // And reopens again, from its latest snapshot.
        let latest = snapshot_of(&host.handle("{\"op\":\"snapshot\"}"));
        let mut third = Host::new();
        let a = third.handle(&open_from(&latest, ""));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        assert_eq!(plane_state(&mut third), plane_state(&mut host));
    }

    /// What `state` says of the plane, without the stats, which start
    /// afresh when a plane is opened.
    fn plane_state(host: &mut Host) -> String {
        let answer = host.handle("{\"op\":\"state\"}");
        ["clock", "queued", "in_flight", "held", "ledger"]
            .map(|name| format!("{:?}", field(&answer, &[name])))
            .join("\n")
    }

    #[test]
    fn a_snapshot_needs_a_checkpoint_and_must_match_its_lines() {
        // No checkpoints: no snapshot.
        let mut host = Host::new();
        let plain = open("").replace("\"checkpoint_every\":2", "\"checkpoint_every\":null");
        host.handle(&plain);
        let a = host.handle("{\"op\":\"snapshot\"}");
        assert_eq!(field(&a, &["snapshot"]), Value::Null, "{a}");

        let mut host = Host::new();
        let mut stored = lines(&host.handle(&open("")));
        stored.extend(lines(&host.handle(&format!(
            "{{\"op\":\"submit\",\"intent\":{},\"now\":1}}",
            intent("bot", 1, "web")
        ))));
        let snapshot = snapshot_of(&host.handle("{\"op\":\"snapshot\"}"));
        // A damaged snapshot is refused.
        let damaged = snapshot.replacen("\"clock\":\"1\"", "\"clock\":\"2\"", 1);
        assert_ne!(damaged, snapshot);
        let a = Host::new().handle(&open_from(&damaged, ""));
        assert_eq!(
            field(&a, &["code"]),
            Value::String("bad_request".into()),
            "{a}"
        );
        // So are lines that do not follow it: the whole ledger, say.
        let a = Host::new().handle(&open_from(&snapshot, &stored.join("\n")));
        assert_eq!(
            field(&a, &["code"]),
            Value::String("bad_request".into()),
            "{a}"
        );
        // And a snapshot naming settings the request does not give.
        let mut host = Host::new();
        host.handle(&open(""));
        host.handle(&format!(
            "{{\"op\":\"submit\",\"intent\":{},\"now\":1}}",
            intent("bot", 1, "web")
        ));
        host.handle(
            "{\"op\":\"reconfigure\",\"label\":\"v3\",\"settings\":{\"burst\":3},\"now\":1}",
        );
        let snapshot = snapshot_of(&host.handle("{\"op\":\"snapshot\"}"));
        let a = Host::new().handle(&open_from(&snapshot, ""));
        assert_eq!(
            field(&a, &["code"]),
            Value::String("cannot_resume".into()),
            "{a}"
        );
    }

    #[test]
    fn a_submitted_intent_is_ruled_on_at_once_and_its_lines_returned() {
        let mut host = Host::new();
        let mut stored = Vec::new();
        let a = host.handle(&open(""));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        stored.extend(lines(&a));

        let a = host.handle(&format!(
            "{{\"op\":\"submit\",\"intent\":{},\"now\":1}}",
            intent("bot", 1, "web")
        ));
        assert_eq!(field(&a, &["accepted"]), Value::Bool(true), "{a}");
        let Value::Array(decisions) = field(&a, &["report", "decisions"]) else {
            panic!()
        };
        assert_eq!(
            get(&decisions[0], "verdict").ok().unwrap(),
            &Value::String("admit".into())
        );
        let new = lines(&a);
        // queued + admit, and the checkpoint the second record completes.
        assert_eq!(new.len(), 3, "{new:?}");
        assert!(new[2].contains("\"type\":\"checkpoint\""));
        stored.extend(new);

        let a = host.handle(&format!(
            "{{\"op\":\"submit\",\"intent\":{},\"now\":2}}",
            intent("bot", 2, "db")
        ));
        let Value::Array(decisions) = field(&a, &["report", "decisions"]) else {
            panic!()
        };
        assert_eq!(
            get(&decisions[0], "verdict").ok().unwrap(),
            &Value::String("defer".into())
        );
        stored.extend(lines(&a));

        let a = host.handle(
            "{\"op\":\"reconfigure\",\"label\":\"v2\",\"settings\":{\"burst\":2},\"now\":3}",
        );
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        stored.extend(lines(&a));

        let a = host.handle(
            "{\"op\":\"release\",\"agent\":\"bot\",\"id\":\"2\",\"by\":\"alice\",\"now\":4}",
        );
        let Value::Array(decisions) = field(&a, &["report", "decisions"]) else {
            panic!("{a}")
        };
        assert_eq!(
            get(&decisions[0], "released_by").ok().unwrap(),
            &Value::String("alice".into())
        );
        stored.extend(lines(&a));

        let a = host.handle("{\"op\":\"complete\",\"agent\":\"bot\",\"id\":\"1\",\"outcome\":\"succeeded\",\"reason\":null,\"now\":5}");
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        stored.extend(lines(&a));
        let head = field(&host.handle("{\"op\":\"state\"}"), &["ledger", "head"]);

        // A new host, as after the Durable Object was evicted, picks up from
        // the stored lines.
        let text = stored.join("\n");
        let mut again = Host::new();
        let a = again.handle(&open(&text));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        assert_eq!(lines(&a), Vec::<String>::new());
        let state = again.handle("{\"op\":\"state\"}");
        assert_eq!(field(&state, &["ledger", "head"]), head);
        let Value::Array(in_flight) = field(&state, &["in_flight"]) else {
            panic!()
        };
        assert_eq!(in_flight.len(), 1);
        let verify = again.handle("{\"op\":\"verify\"}");
        assert_eq!(field(&verify, &["verified"]), Value::Bool(true), "{verify}");
        assert_eq!(
            field(&verify, &["signed_checkpoints", "failed_at"]),
            Value::Null,
            "{verify}"
        );
    }

    #[test]
    fn a_submitted_intent_carries_its_review_through_the_plane() {
        let reviewed = |id: u64, review: &str| {
            let plain = intent("bot", id, "web");
            format!(
                "{{\"op\":\"submit\",\"intent\":{},\"review\":{review}}},\"now\":{id}}}",
                &plain[..plain.len() - 1]
            )
        };
        let sha = "ab".repeat(32);
        let defer = format!(
            "{{\"model\":\"claude-opus-5-5\",\"prompt_sha256\":\"{sha}\",\"outcome\":\"defer\",\"reason\":\"drops a table\"}}"
        );
        let clear = format!(
            "{{\"model\":\"claude-opus-5-5\",\"prompt_sha256\":\"{sha}\",\"outcome\":\"clear\"}}"
        );
        let mut host = Host::new();
        let mut stored = lines(&host.handle(&open("")));

        // web is allowed by the rules: only the review holds it.
        let a = host.handle(&reviewed(1, &defer));
        assert_eq!(field(&a, &["accepted"]), Value::Bool(true), "{a}");
        let Value::Array(decisions) = field(&a, &["report", "decisions"]) else {
            panic!("{a}")
        };
        assert_eq!(
            get(&decisions[0], "verdict").ok().unwrap(),
            &Value::String("defer".into())
        );
        assert!(
            a.contains(
                "{\"policy\":\"ai-review\",\"verdict\":\"defer\",\"reason\":\"drops a table\"}"
            ),
            "{a}"
        );
        let new = lines(&a);
        assert!(
            new.iter()
                .filter(|l| l.contains("\"type\":\"record\""))
                .all(|l| l.contains(&defer)),
            "{new:?}"
        );
        stored.extend(new);
        let state = host.handle("{\"op\":\"state\"}");
        assert!(state.contains(&format!("\"review\":{}", &defer)), "{state}");

        // A clear review admits nothing the rules would not.
        let a = host.handle(&reviewed(2, &clear));
        let Value::Array(decisions) = field(&a, &["report", "decisions"]) else {
            panic!("{a}")
        };
        assert_eq!(
            get(&decisions[0], "verdict").ok().unwrap(),
            &Value::String("admit".into())
        );
        stored.extend(lines(&a));

        // The held, reviewed intent survives a snapshot and a reopen from
        // the lines alone.
        let a = host.handle("{\"op\":\"snapshot\"}");
        stored.extend(lines(&a));
        let snapshot = snapshot_of(&a);
        assert!(snapshot.contains(&defer), "{snapshot}");
        let state = plane_state(&mut host);
        let mut from_snapshot = Host::new();
        let a = from_snapshot.handle(&open_from(&snapshot, ""));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        assert_eq!(plane_state(&mut from_snapshot), state);
        let mut from_lines = Host::new();
        let a = from_lines.handle(&open(&stored.join("\n")));
        assert_eq!(field(&a, &["ok"]), Value::Bool(true), "{a}");
        assert_eq!(plane_state(&mut from_lines), state);

        // A release waives the review's defer like any other (once bot#2
        // frees the web lane).
        both(
            &mut host,
            &mut from_snapshot,
            "{\"op\":\"complete\",\"agent\":\"bot\",\"id\":\"2\",\"outcome\":\"succeeded\",\"reason\":null,\"now\":3}",
        );
        let release =
            "{\"op\":\"release\",\"agent\":\"bot\",\"id\":\"1\",\"by\":\"alice\",\"now\":3}";
        let a = both(&mut host, &mut from_snapshot, release);
        assert!(
            a.contains("released by alice, overriding: drops a table"),
            "{a}"
        );

        // A malformed review is refused.
        for bad in [
            format!("{{\"model\":\"m\",\"prompt_sha256\":\"{sha}\",\"outcome\":\"admit\"}}"),
            format!("{{\"model\":\"m\",\"prompt_sha256\":\"{sha}\",\"outcome\":\"defer\"}}"),
            format!("{{\"model\":\"m\",\"prompt_sha256\":\"{sha}\",\"outcome\":\"clear\",\"reason\":\"x\"}}"),
            "{\"model\":\"m\",\"prompt_sha256\":\"AB\",\"outcome\":\"clear\"}".to_string(),
        ] {
            let a = host.handle(&reviewed(9, &bad));
            assert_eq!(field(&a, &["code"]), Value::String("bad_request".into()), "{a}");
        }
    }

    #[test]
    fn refusals_say_why() {
        let mut host = Host::new();
        let a = host.handle("{\"op\":\"tick\",\"now\":1}");
        assert_eq!(field(&a, &["code"]), Value::String("not_open".into()));
        let a = host.handle("not json");
        assert_eq!(field(&a, &["code"]), Value::String("bad_request".into()));
        host.handle(&open(""));
        let a =
            host.handle("{\"op\":\"release\",\"agent\":\"x\",\"id\":\"9\",\"by\":\"a\",\"now\":1}");
        assert_eq!(field(&a, &["code"]), Value::String("refused".into()), "{a}");
        let a = host.handle("{\"op\":\"reconfigure\",\"label\":\"x\",\"settings\":{\"rules\":\"nonsense\"},\"now\":1}");
        assert_eq!(
            field(&a, &["code"]),
            Value::String("bad_rules".into()),
            "{a}"
        );
    }

    #[test]
    fn a_dry_run_rules_without_a_plane() {
        let mut host = Host::new();
        let a = host.handle(&format!(
            "{{\"op\":\"dry_run\",\"settings\":{{\"rules\":\"{ALLOW_WEB}\"}},\"intents\":[{},{}]}}",
            intent("bot", 1, "web"),
            intent("bot", 2, "db")
        ));
        let Value::Array(d) = field(&a, &["decisions"]) else {
            panic!("{a}")
        };
        assert_eq!(
            get(&d[0], "verdict").ok().unwrap(),
            &Value::String("admit".into())
        );
        assert_eq!(
            get(&d[1], "verdict").ok().unwrap(),
            &Value::String("defer".into())
        );
        assert!(!a.contains("\"lines\""));
    }

    #[test]
    fn a_rate_limited_intent_is_refused_without_a_pass() {
        let mut host = Host::new();
        host.handle(&open(""));
        host.handle("{\"op\":\"reconfigure\",\"label\":\"v2\",\"settings\":{\"burst\":1,\"refill_millis\":0},\"now\":1}");
        host.handle(&format!(
            "{{\"op\":\"submit\",\"intent\":{},\"now\":1}}",
            intent("bot", 1, "web")
        ));
        let a = host.handle(&format!(
            "{{\"op\":\"submit\",\"intent\":{},\"now\":1}}",
            intent("bot", 2, "web")
        ));
        assert_eq!(
            field(&a, &["refused"]),
            Value::String("rate_limited".into()),
            "{a}"
        );
        assert_eq!(lines(&a), Vec::<String>::new());
    }
}

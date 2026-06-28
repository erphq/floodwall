//! Tamper-evident provenance.
//!
//! Every decision the cofferdam makes is appended to a hash chain: each
//! record's digest folds in the previous record's digest, so any retroactive
//! edit to history breaks the chain from that point forward. [`Ledger::verify`]
//! recomputes the whole chain and confirms nothing has been altered.
//!
//! v0.1 uses a hand-rolled 64-bit FNV-1a as the digest - enough to detect
//! accidental corruption and to demonstrate the chain. Swap in a cryptographic
//! hash (see the sibling crate `shunya` for a from-scratch SHA-256) before
//! trusting it against a motivated adversary.

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn fnv1a(seed: u64, bytes: &[u8]) -> u64 {
    let mut h = seed;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(FNV_PRIME);
    }
    h
}

/// One immutable decision in the chain.
#[derive(Clone, Debug)]
pub struct Record {
    /// Position in the chain, from 0.
    pub seq: u64,
    /// The intent that was ruled on.
    pub intent_id: u64,
    /// The agent that authored the intent.
    pub agent: String,
    /// The verdict label: `admit` / `reject` / `defer`.
    pub verdict: String,
    /// Digest of the previous record - the chain link.
    pub prev: u64,
    /// Digest of this record.
    pub digest: u64,
}

/// An append-only, hash-chained log of decisions.
pub struct Ledger {
    records: Vec<Record>,
    head: u64,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::new()
    }
}

impl Ledger {
    /// A fresh ledger whose head is the genesis seed.
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
            head: FNV_OFFSET,
        }
    }

    fn digest(prev: u64, seq: u64, intent_id: u64, agent: &str, verdict: &str) -> u64 {
        let mut h = fnv1a(FNV_OFFSET, &prev.to_le_bytes());
        h = fnv1a(h, &seq.to_le_bytes());
        h = fnv1a(h, &intent_id.to_le_bytes());
        h = fnv1a(h, agent.as_bytes());
        h = fnv1a(h, verdict.as_bytes());
        h
    }

    /// Append a decision and return the record just written.
    pub fn append(&mut self, intent_id: u64, agent: &str, verdict: &str) -> &Record {
        let seq = self.records.len() as u64;
        let prev = self.head;
        let digest = Self::digest(prev, seq, intent_id, agent, verdict);
        self.head = digest;
        self.records.push(Record {
            seq,
            intent_id,
            agent: agent.to_string(),
            verdict: verdict.to_string(),
            prev,
            digest,
        });
        self.records.last().expect("a record was just pushed")
    }

    /// Recompute the chain from genesis and confirm nothing has been altered.
    pub fn verify(&self) -> bool {
        let mut prev = FNV_OFFSET;
        for r in &self.records {
            if r.prev != prev {
                return false;
            }
            let digest = Self::digest(prev, r.seq, r.intent_id, &r.agent, &r.verdict);
            if digest != r.digest {
                return false;
            }
            prev = digest;
        }
        true
    }

    /// The current head digest - a fingerprint of the entire history.
    pub fn head(&self) -> u64 {
        self.head
    }

    /// The recorded decisions, oldest first.
    pub fn records(&self) -> &[Record] {
        &self.records
    }

    /// How many decisions are recorded.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// Whether the ledger is empty.
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_ledger_verifies() {
        let l = Ledger::new();
        assert!(l.is_empty());
        assert!(l.verify());
        assert_eq!(l.head(), FNV_OFFSET);
    }

    #[test]
    fn appending_links_the_chain() {
        let mut l = Ledger::new();
        let first = l.head();
        l.append(1, "bot", "admit");
        let second = l.head();
        l.append(2, "bot", "reject");
        assert_eq!(l.len(), 2);
        assert!(l.verify());
        // Head advances with every append.
        assert_ne!(first, second);
        assert_ne!(second, l.head());
        // Each record links to the one before it.
        assert_eq!(l.records()[1].prev, l.records()[0].digest);
    }

    #[test]
    fn tampering_breaks_verification() {
        let mut l = Ledger::new();
        l.append(1, "bot", "admit");
        l.append(2, "bot", "admit");
        l.append(3, "bot", "reject");
        assert!(l.verify());
        // Rewrite history: flip a recorded verdict without recomputing digests.
        // The test module can reach the private field; production code cannot.
        l.records[1].verdict = "reject".to_string();
        assert!(!l.verify());
    }
}

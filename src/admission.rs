//! Admission control - the gate's throughput governor.
//!
//! Even an intent that would pass every policy has to get through the wall
//! first. This is what makes high volume survivable:
//!
//! - a per-agent **token bucket** caps how fast any one agent can push, so a
//!   single runaway loop cannot starve the rest of the fleet;
//! - a **bounded priority queue** orders what is waiting (highest priority
//!   first, FIFO within a priority) and applies **backpressure** once the
//!   enclosure is full.
//!
//! Time is a logical tick supplied by the caller, so behaviour is fully
//! deterministic and testable - there is no wall clock anywhere in here.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

use crate::intent::{AgentId, Intent, Priority};

/// Token-bucket parameters, applied per agent.
#[derive(Clone, Copy, Debug)]
pub struct RateLimit {
    /// Maximum burst: the bucket's capacity in tokens.
    pub burst: f64,
    /// Tokens refilled per logical tick.
    pub refill_per_tick: f64,
}

impl RateLimit {
    /// A limit allowing up to `burst` queued at once, refilling
    /// `refill_per_tick` tokens each tick.
    pub fn new(burst: f64, refill_per_tick: f64) -> Self {
        Self {
            burst,
            refill_per_tick,
        }
    }
}

#[derive(Debug)]
struct Bucket {
    tokens: f64,
    last: u64,
}

impl Bucket {
    fn new(limit: RateLimit, now: u64) -> Self {
        Self {
            tokens: limit.burst,
            last: now,
        }
    }

    fn try_take(&mut self, limit: RateLimit, now: u64) -> bool {
        if now > self.last {
            let elapsed = (now - self.last) as f64;
            self.tokens = (self.tokens + elapsed * limit.refill_per_tick).min(limit.burst);
            self.last = now;
        }
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Why an intent could not be queued.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejected {
    /// The agent is over its rate limit for this tick.
    RateLimited,
    /// The queue is at capacity - the enclosure is full, come back later.
    Backpressure,
}

// Heap ordering. `BinaryHeap` is a max-heap, so the element it pops is the
// "greatest". We want highest priority first, and within one priority the
// lowest sequence number (FIFO) - so a smaller seq must compare as greater.
#[derive(Debug)]
struct Queued {
    priority: Priority,
    seq: u64,
    intent: Intent,
}

impl PartialEq for Queued {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq
    }
}

impl Eq for Queued {}

impl Ord for Queued {
    fn cmp(&self, other: &Self) -> Ordering {
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for Queued {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// The front door: per-agent rate limiting in front of a bounded priority queue.
pub struct Admission {
    queue: BinaryHeap<Queued>,
    capacity: usize,
    seq: u64,
    limit: RateLimit,
    buckets: HashMap<AgentId, Bucket>,
}

impl Admission {
    /// A controller holding at most `capacity` waiting intents, with `limit`
    /// applied to each agent independently.
    pub fn new(capacity: usize, limit: RateLimit) -> Self {
        Self {
            queue: BinaryHeap::new(),
            capacity,
            seq: 0,
            limit,
            buckets: HashMap::new(),
        }
    }

    /// Try to admit an intent into the queue at logical time `now`.
    ///
    /// Backpressure is checked before the rate limit, so a full enclosure does
    /// not burn the agent's tokens.
    pub fn submit(&mut self, intent: Intent, now: u64) -> Result<(), Rejected> {
        if self.queue.len() >= self.capacity {
            return Err(Rejected::Backpressure);
        }
        let limit = self.limit;
        let bucket = self
            .buckets
            .entry(intent.agent.clone())
            .or_insert_with(|| Bucket::new(limit, now));
        if !bucket.try_take(limit, now) {
            return Err(Rejected::RateLimited);
        }
        let seq = self.seq;
        self.seq += 1;
        self.queue.push(Queued {
            priority: intent.priority,
            seq,
            intent,
        });
        Ok(())
    }

    /// Pull the next intent to process: highest priority, FIFO within a
    /// priority. Returns `None` when nothing is waiting.
    pub fn dequeue(&mut self) -> Option<Intent> {
        self.queue.pop().map(|q| q.intent)
    }

    /// How many intents are waiting.
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// Whether the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, BlastRadius};

    fn intent_for(agent: &str, id: u64, priority: Priority) -> Intent {
        Intent::new(
            id,
            AgentId::new(agent),
            Action::Apply {
                resource: "web".into(),
                manifest: String::new(),
            },
            priority,
            BlastRadius::Cell,
        )
    }

    #[test]
    fn rate_limit_caps_the_burst_then_refills() {
        // burst 3, refill 1/tick.
        let mut a = Admission::new(1_000, RateLimit::new(3.0, 1.0));
        // First three at tick 0 go through; the fourth is rate-limited.
        for id in 0..3 {
            assert_eq!(a.submit(intent_for("bot", id, Priority::Normal), 0), Ok(()));
        }
        assert_eq!(
            a.submit(intent_for("bot", 3, Priority::Normal), 0),
            Err(Rejected::RateLimited)
        );
        // One tick later, one token has refilled: exactly one more gets in.
        assert_eq!(a.submit(intent_for("bot", 4, Priority::Normal), 1), Ok(()));
        assert_eq!(
            a.submit(intent_for("bot", 5, Priority::Normal), 1),
            Err(Rejected::RateLimited)
        );
    }

    #[test]
    fn limits_are_per_agent() {
        let mut a = Admission::new(1_000, RateLimit::new(1.0, 0.0));
        assert_eq!(a.submit(intent_for("x", 0, Priority::Normal), 0), Ok(()));
        // x is spent, but y has its own bucket.
        assert_eq!(
            a.submit(intent_for("x", 1, Priority::Normal), 0),
            Err(Rejected::RateLimited)
        );
        assert_eq!(a.submit(intent_for("y", 0, Priority::Normal), 0), Ok(()));
    }

    #[test]
    fn backpressure_when_full() {
        // capacity 2, generous rate limit.
        let mut a = Admission::new(2, RateLimit::new(100.0, 0.0));
        assert_eq!(a.submit(intent_for("x", 0, Priority::Normal), 0), Ok(()));
        assert_eq!(a.submit(intent_for("x", 1, Priority::Normal), 0), Ok(()));
        assert_eq!(
            a.submit(intent_for("x", 2, Priority::Normal), 0),
            Err(Rejected::Backpressure)
        );
    }

    #[test]
    fn dequeue_is_priority_then_fifo() {
        let mut a = Admission::new(1_000, RateLimit::new(100.0, 0.0));
        // Submit out of priority order, with two at the same priority.
        a.submit(intent_for("x", 0, Priority::Normal), 0).unwrap();
        a.submit(intent_for("x", 1, Priority::Pager), 0).unwrap();
        a.submit(intent_for("x", 2, Priority::Normal), 0).unwrap();
        a.submit(intent_for("x", 3, Priority::Bulk), 0).unwrap();
        // Pager first.
        assert_eq!(a.dequeue().unwrap().id, 1);
        // Then the two Normals, in submission order (FIFO).
        assert_eq!(a.dequeue().unwrap().id, 0);
        assert_eq!(a.dequeue().unwrap().id, 2);
        // Bulk last.
        assert_eq!(a.dequeue().unwrap().id, 3);
        assert!(a.dequeue().is_none());
    }
}

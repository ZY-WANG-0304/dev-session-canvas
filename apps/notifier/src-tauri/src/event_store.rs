use crate::protocol::Event;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::PathBuf,
};
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StoredEvent {
    pub source: String,
    pub token: String,
    pub event: Event,
    pub withdrawn: bool,
    #[serde(default)]
    pub display: Option<Display>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Display {
    pub title: String,
    pub body: String,
}
pub struct EventStore {
    path: PathBuf,
    records: Vec<StoredEvent>,
}
impl EventStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let records = match options.open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(24 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 24 * 1024 * 1024 {
                    return Err("store-too-large".into());
                }
                let records: Vec<StoredEvent> =
                    serde_json::from_slice(&bytes).map_err(|_| "store-invalid")?;
                if records.len() > 2000
                    || records
                        .iter()
                        .map(|r| (&r.source, &r.event.event_id))
                        .collect::<HashSet<_>>()
                        .len()
                        != records.len()
                    || records
                        .iter()
                        .map(|r| &r.token)
                        .collect::<HashSet<_>>()
                        .len()
                        != records.len()
                    || records.iter().any(|r| {
                        !r.event.valid(r.event.occurred_at)
                            || !crate::protocol::text(&r.source, 256)
                            || !valid_token(&r.token)
                            || r.display.as_ref().is_some_and(|d| {
                                !crate::protocol::text(&d.title, 512)
                                    || !crate::protocol::text(&d.body, 8192)
                            })
                    })
                {
                    return Err("store-invalid".into());
                }
                records
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self { path, records })
    }
    pub fn query(&self, source: &str, id: &str) -> Option<&StoredEvent> {
        self.records
            .iter()
            .find(|r| r.source == source && r.event.event_id == id)
    }
    pub fn active(&self, source: &str, now: u64) -> Vec<StoredEvent> {
        self.records
            .iter()
            .filter(|r| r.source == source && !r.withdrawn && r.event.expires_at > now)
            .cloned()
            .collect()
    }
    pub fn publish(
        &mut self,
        source: &str,
        token: String,
        event: Event,
        now: u64,
    ) -> Result<(StoredEvent, bool), String> {
        if !event.valid(now) || !crate::protocol::text(source, 256) || !valid_token(&token) {
            return Err("invalid-event".into());
        }
        if let Some(old) = self.query(source, &event.event_id) {
            return if old.event == event {
                Ok((old.clone(), false))
            } else {
                Err("event-conflict".into())
            };
        }
        if self.records.iter().any(|r| r.token == token) {
            return Err("token-conflict".into());
        }
        if self.active(source, now).len() >= 256 {
            return Err("source-capacity".into());
        }
        let mut records = self.records.clone();
        records.retain(|r| now.saturating_sub(r.event.occurred_at) <= 7 * 86400000);
        if records.len() >= 2000 {
            return Err("store-capacity".into());
        }
        let record = StoredEvent {
            source: source.into(),
            token,
            event,
            withdrawn: false,
            display: None,
        };
        records.push(record.clone());
        self.commit(records)?;
        Ok((record, true))
    }
    pub fn withdraw(&mut self, source: &str, id: &str) -> Result<Option<String>, String> {
        let mut records = self.records.clone();
        let token = records
            .iter_mut()
            .find(|r| r.source == source && r.event.event_id == id)
            .map(|r| {
                r.withdrawn = true;
                r.token.clone()
            });
        if token.is_some() {
            self.commit(records)?;
        }
        Ok(token)
    }
    pub fn update(
        &mut self,
        source: &str,
        id: &str,
        title: String,
        body: String,
        now: u64,
    ) -> Result<(), String> {
        if !crate::protocol::text(&title, 512) || !crate::protocol::text(&body, 8192) {
            return Err("invalid-display".into());
        }
        let mut records = self.records.clone();
        let record = records
            .iter_mut()
            .find(|r| {
                r.source == source
                    && r.event.event_id == id
                    && !r.withdrawn
                    && r.event.expires_at > now
            })
            .ok_or("inactive-event")?;
        record.display = Some(Display { title, body });
        self.commit(records)
    }
    fn commit(&mut self, records: Vec<StoredEvent>) -> Result<(), String> {
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt;
        let temp = self.path.with_extension("pending");
        let mut created = false;
        let result = (|| -> Result<(), String> {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temp).map_err(|e| e.to_string())?;
            created = true;
            let bytes = serde_json::to_vec(&records).map_err(|e| e.to_string())?;
            if bytes.len() > 24 * 1024 * 1024 {
                return Err("store-capacity".into());
            }
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            fs::rename(&temp, &self.path).map_err(|e| e.to_string())?;
            // Rename is committed. Directory-sync failures are unknown durability, never explicit rejection.
            self.records = records;
            if let Some(parent) = self.path.parent() {
                fs::File::open(parent)
                    .and_then(|f| f.sync_all())
                    .map_err(|_| "commit-unknown".to_string())?;
            }
            Ok(())
        })();
        if created && result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}
fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disk_failure_never_changes_in_memory_receipt() {
        let path = std::env::temp_dir()
            .join(format!("dsc-store-missing-{}", std::process::id()))
            .join("events.json");
        let mut store = EventStore::open(path).unwrap();
        let event = Event {
            event_id: "e".into(),
            workspace_id: "w".into(),
            canvas_id: "c".into(),
            node_id: "n".into(),
            execution_generation: "1".into(),
            occurred_at: 100,
            expires_at: 200,
            merge_key: "k".into(),
            title: "t".into(),
            body: "b".into(),
            play_sound: false,
        };
        assert!(store.publish("source", "a".repeat(64), event, 100).is_err());
        assert!(store.query("source", "e").is_none());
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    fn fixture() -> (PathBuf, Event) {
        let root = std::env::temp_dir().join(format!(
            "dsc-store-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let event = Event {
            event_id: "e".into(),
            workspace_id: "w".into(),
            canvas_id: "c".into(),
            node_id: "n".into(),
            execution_generation: "1".into(),
            occurred_at: 100,
            expires_at: 1000,
            merge_key: "k".into(),
            title: "t".into(),
            body: "b".into(),
            play_sound: false,
        };
        (root, event)
    }
    #[test]
    fn reload_dedupe_update_and_source_isolation() {
        let (root, event) = fixture();
        let path = root.join("events.json");
        let mut store = EventStore::open(path.clone()).unwrap();
        assert!(
            store
                .publish("a", "a".repeat(64), event.clone(), 100)
                .unwrap()
                .1
        );
        store
            .update("a", "e", "edited".into(), "body".into(), 100)
            .unwrap();
        let mut store = EventStore::open(path).unwrap();
        assert!(
            !store
                .publish("a", "b".repeat(64), event.clone(), 100)
                .unwrap()
                .1
        );
        assert_eq!(
            store
                .query("a", "e")
                .unwrap()
                .display
                .as_ref()
                .unwrap()
                .title,
            "edited"
        );
        store
            .publish("b", "b".repeat(64), event.clone(), 100)
            .unwrap();
        store.withdraw("a", "e").unwrap();
        assert!(store.query("a", "e").unwrap().withdrawn);
        assert!(!store.query("b", "e").unwrap().withdrawn);
        assert!(
            store
                .publish("a", "c".repeat(64), event.clone(), 100)
                .unwrap()
                .0
                .withdrawn
        );
        let mut different = event;
        different.execution_generation = "2".into();
        assert!(store.publish("a", "c".repeat(64), different, 100).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_exclusive_create_does_not_delete_someone_elses_pending_file() {
        let (root, event) = fixture();
        let path = root.join("events.json");
        let mut store = EventStore::open(path).unwrap();
        let pending = root.join("events.pending");
        fs::write(&pending, b"owned by another operation").unwrap();
        assert!(store.publish("a", "a".repeat(64), event, 100).is_err());
        assert_eq!(fs::read(&pending).unwrap(), b"owned by another operation");
        assert!(store.query("a", "e").is_none());
        fs::remove_dir_all(root).unwrap();
    }
}

//! Live routing only. Callers must durably store an event before tracking it here.
//! A new transport connection never inherits another connection's routes implicitly.
use crate::protocol::Event;
use std::collections::HashMap;
#[derive(Clone, Debug, PartialEq)]
pub struct FocusTarget {
    pub connection_id: u64,
    pub source_instance_id: String,
    pub event: Event,
}
#[derive(Debug, PartialEq)]
pub enum RouteError {
    Offline,
    Conflict,
    Invalid,
    Expired,
    Capacity,
}
struct Source {
    connection_id: u64,
    workspace_id: String,
}
struct Route {
    source_instance_id: String,
    event: Event,
}
#[derive(Default)]
pub struct SourceRegistry {
    sources: HashMap<String, Source>,
    routes: HashMap<String, Route>,
}
impl SourceRegistry {
    pub fn register(
        &mut self,
        source: String,
        connection: u64,
        workspace: String,
    ) -> Result<(), RouteError> {
        if source.is_empty() || workspace.is_empty() {
            return Err(RouteError::Invalid);
        }
        if let Some(existing) = self.sources.get(&source) {
            if existing.connection_id == connection && existing.workspace_id == workspace {
                return Ok(());
            }
            return Err(RouteError::Conflict);
        }
        if self
            .sources
            .values()
            .any(|registered| registered.connection_id == connection)
        {
            return Err(RouteError::Conflict);
        }
        if self.sources.len() >= 16 {
            return Err(RouteError::Capacity);
        }
        self.sources.insert(
            source,
            Source {
                connection_id: connection,
                workspace_id: workspace,
            },
        );
        Ok(())
    }
    pub fn disconnect(&mut self, connection: u64) {
        let disconnected: Vec<_> = self
            .sources
            .iter()
            .filter(|(_, s)| s.connection_id == connection)
            .map(|(id, _)| id.clone())
            .collect();
        for id in disconnected {
            self.sources.remove(&id);
            self.routes.retain(|_, r| r.source_instance_id != id);
        }
    }
    pub fn validate_event(
        &self,
        connection: u64,
        source: &str,
        token: &str,
        event: &Event,
        now: u64,
    ) -> Result<(), RouteError> {
        let registered = self.sources.get(source).ok_or(RouteError::Offline)?;
        if registered.connection_id != connection || registered.workspace_id != event.workspace_id {
            return Err(RouteError::Invalid);
        }
        if !event.valid(now) || token.is_empty() {
            return Err(RouteError::Invalid);
        }
        if let Some(existing) = self.routes.get(token) {
            return if existing.source_instance_id == source && existing.event == *event {
                Ok(())
            } else {
                Err(RouteError::Conflict)
            };
        }
        // Do not allow another token to silently redefine an existing logical event.
        if self
            .routes
            .values()
            .any(|r| r.source_instance_id == source && r.event.event_id == event.event_id)
        {
            return Err(RouteError::Conflict);
        }
        if !self.routes.contains_key(token)
            && self
                .routes
                .values()
                .filter(|r| r.event.expires_at > now)
                .count()
                >= 2000
        {
            return Err(RouteError::Capacity);
        }
        Ok(())
    }
    pub fn track_persisted_event(
        &mut self,
        connection: u64,
        source: &str,
        token: String,
        event: Event,
        now: u64,
    ) -> Result<(), RouteError> {
        self.validate_event(connection, source, &token, &event, now)?;
        self.routes.retain(|_, r| r.event.expires_at > now);
        if self.routes.len() >= 2000 {
            return Err(RouteError::Capacity);
        }
        self.routes.insert(
            token,
            Route {
                source_instance_id: source.into(),
                event,
            },
        );
        Ok(())
    }
    pub fn focus(&self, token: &str, now: u64) -> Result<FocusTarget, RouteError> {
        let route = self.routes.get(token).ok_or(RouteError::Invalid)?;
        if route.event.expires_at <= now {
            return Err(RouteError::Expired);
        }
        let source = self
            .sources
            .get(&route.source_instance_id)
            .ok_or(RouteError::Offline)?;
        Ok(FocusTarget {
            connection_id: source.connection_id,
            source_instance_id: route.source_instance_id.clone(),
            event: route.event.clone(),
        })
    }
    pub fn withdraw(
        &mut self,
        connection: u64,
        source: &str,
        event: &str,
    ) -> Result<(), RouteError> {
        if self.sources.get(source).map(|s| s.connection_id) != Some(connection) {
            return Err(RouteError::Offline);
        }
        self.routes
            .retain(|_, r| !(r.source_instance_id == source && r.event.event_id == event));
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn event(workspace: &str) -> Event {
        Event {
            event_id: "same-event".into(),
            workspace_id: workspace.into(),
            canvas_id: "same-canvas".into(),
            node_id: "same-node".into(),
            execution_generation: "run:1".into(),
            occurred_at: 100,
            expires_at: 1000,
            merge_key: "same-key".into(),
            title: "同名节点".into(),
            body: "等待输入".into(),
            play_sound: false,
        }
    }
    #[test]
    fn identical_names_and_ids_route_to_original_connection() {
        let mut registry = SourceRegistry::default();
        registry
            .register("A".into(), 1, "workspace".into())
            .unwrap();
        registry
            .register("B".into(), 2, "workspace".into())
            .unwrap();
        registry
            .track_persisted_event(1, "A", "token-a".into(), event("workspace"), 100)
            .unwrap();
        registry
            .track_persisted_event(2, "B", "token-b".into(), event("workspace"), 100)
            .unwrap();
        assert_eq!(registry.focus("token-a", 100).unwrap().connection_id, 1);
        assert_eq!(registry.focus("token-b", 100).unwrap().connection_id, 2);
        assert_eq!(
            registry.withdraw(2, "A", "same-event"),
            Err(RouteError::Offline)
        );
        registry.withdraw(1, "A", "same-event").unwrap();
        assert_eq!(registry.focus("token-a", 100), Err(RouteError::Invalid));
        assert_eq!(registry.focus("token-b", 100).unwrap().connection_id, 2);
    }
    #[test]
    fn disconnected_replacement_cannot_inherit_old_token() {
        let mut r = SourceRegistry::default();
        r.register("A".into(), 1, "workspace".into()).unwrap();
        r.track_persisted_event(1, "A", "old".into(), event("workspace"), 100)
            .unwrap();
        assert_eq!(
            r.register("A".into(), 2, "workspace".into()),
            Err(RouteError::Conflict)
        );
        r.disconnect(1);
        r.register("A".into(), 2, "workspace".into()).unwrap();
        assert_eq!(r.focus("old", 100), Err(RouteError::Invalid));
        r.disconnect(1); // Delayed close of the old transport must not disconnect the replacement.
        r.track_persisted_event(2, "A", "new".into(), event("workspace"), 100)
            .unwrap();
        assert_eq!(r.focus("new", 100).unwrap().connection_id, 2);
    }
    #[test]
    fn collision_generation_and_expiry_are_rejected() {
        let mut r = SourceRegistry::default();
        r.register("A".into(), 1, "workspace".into()).unwrap();
        assert_eq!(
            r.track_persisted_event(1, "A", "x".into(), event("other"), 100),
            Err(RouteError::Invalid)
        );
        r.track_persisted_event(1, "A", "x".into(), event("workspace"), 100)
            .unwrap();
        let mut newer = event("workspace");
        newer.execution_generation = "run:2".into();
        assert_eq!(
            r.track_persisted_event(1, "A", "x".into(), newer, 100),
            Err(RouteError::Conflict)
        );
        assert_eq!(r.focus("x", 1000), Err(RouteError::Expired));
    }
}

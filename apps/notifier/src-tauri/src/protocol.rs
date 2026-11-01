use serde::{Deserialize, Serialize};
pub const MAX_FRAME_BYTES: usize = 65536;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub event_id: String,
    pub workspace_id: String,
    pub canvas_id: String,
    pub node_id: String,
    pub execution_generation: String,
    pub occurred_at: u64,
    pub expires_at: u64,
    pub merge_key: String,
    pub title: String,
    pub body: String,
    pub play_sound: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Register {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        capabilities: Vec<String>,
    },
    Publish {
        event: Event,
    },
    Update {
        #[serde(rename = "eventId")]
        event_id: String,
        title: String,
        body: String,
    },
    Withdraw {
        #[serde(rename = "eventId")]
        event_id: String,
    },
    Query {
        #[serde(rename = "eventId")]
        event_id: String,
    },
    Sync {
        #[serde(rename = "eventIds")]
        event_ids: Vec<String>,
    },
    FocusResult {
        #[serde(rename = "focusRequestId")]
        focus_request_id: String,
        result: String,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub version: u8,
    pub request_id: String,
    pub credential: String,
    pub source_instance_id: String,
    pub operation: Operation,
}
pub(crate) fn text(value: &str, max: usize) -> bool {
    !value.trim_matches(' ').is_empty()
        && value.len() <= max
        && !value.chars().any(|c| c.is_control())
}
impl Event {
    pub fn valid(&self, now: u64) -> bool {
        [
            &self.event_id,
            &self.workspace_id,
            &self.canvas_id,
            &self.node_id,
            &self.execution_generation,
            &self.merge_key,
        ]
        .iter()
        .all(|v| text(v, 256))
            && text(&self.title, 512)
            && text(&self.body, 8192)
            && self.occurred_at <= MAX_SAFE_INTEGER
            && self.expires_at <= MAX_SAFE_INTEGER
            && self.expires_at > now
            && self.occurred_at <= now.saturating_add(60000)
            && self.expires_at > self.occurred_at
            && self.expires_at - self.occurred_at <= 86400000
    }
}
impl Request {
    pub fn valid(&self, now: u64) -> bool {
        if now > MAX_SAFE_INTEGER
            || self.version != 2
            || !text(&self.request_id, 256)
            || !text(&self.source_instance_id, 256)
            || self.credential.len() != 64
            || !self
                .credential
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return false;
        }
        match &self.operation {
            Operation::Register {
                workspace_id,
                capabilities,
            } => text(workspace_id, 256) && capabilities == &["focus-node"],
            Operation::Publish { event } => event.valid(now),
            Operation::Update {
                event_id,
                title,
                body,
            } => text(event_id, 256) && text(title, 512) && text(body, 8192),
            Operation::Withdraw { event_id } | Operation::Query { event_id } => text(event_id, 256),
            Operation::Sync { event_ids } => {
                event_ids.len() <= 256
                    && event_ids.iter().all(|v| text(v, 256))
                    && event_ids
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == event_ids.len()
            }
            Operation::FocusResult {
                focus_request_id,
                result,
            } => {
                text(focus_request_id, 256)
                    && ["focused", "stale", "offline"].contains(&result.as_str())
            }
        }
    }
}
pub fn decode_frame(bytes: &[u8], now: u64) -> Option<Request> {
    if bytes.len() > MAX_FRAME_BYTES
        || bytes.last() != Some(&b'\n')
        || bytes[..bytes.len() - 1].contains(&b'\n')
    {
        return None;
    }
    let request: Request = serde_json::from_slice(&bytes[..bytes.len() - 1]).ok()?;
    request.valid(now).then_some(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_typescript_rust_vectors() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/attention-protocol/tests/native-vectors.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                decode_frame(
                    case["frame"].as_str().unwrap().as_bytes(),
                    case["now"].as_u64().unwrap()
                )
                .is_some(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
        assert!(decode_frame(&[0xff, b'\n'], 1700000000000).is_none());
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub event_id: String,
    pub workspace_id: String,
    pub canvas_id: String,
    pub node_id: String,
    pub execution_generation: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventState {
    Stored,
    Withdrawn,
    Absent,
}
fn present_event_state<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<EventState>, D::Error> {
    EventState::deserialize(deserializer).map(Some)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReceiptResult {
    Accepted {
        #[serde(
            rename = "eventState",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present_event_state"
        )]
        event_state: Option<EventState>,
    },
    Rejected {
        code: String,
    },
    Unknown {
        code: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ServerMessage {
    #[serde(rename = "receipt")]
    Receipt {
        version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        result: ReceiptResult,
    },
    #[serde(rename = "focus-node")]
    Focus {
        version: u8,
        #[serde(rename = "focusRequestId")]
        focus_request_id: String,
        target: Target,
    },
}
pub fn decode_server_frame(bytes: &[u8]) -> Option<ServerMessage> {
    if bytes.len() > MAX_FRAME_BYTES
        || bytes.last() != Some(&b'\n')
        || bytes[..bytes.len() - 1].contains(&b'\n')
    {
        return None;
    }
    let message: ServerMessage = serde_json::from_slice(&bytes[..bytes.len() - 1]).ok()?;
    let valid = match &message {
        ServerMessage::Receipt {
            version,
            request_id,
            result,
        } => {
            *version == 2
                && text(request_id, 256)
                && match result {
                    ReceiptResult::Accepted { .. } => true,
                    ReceiptResult::Rejected { code } | ReceiptResult::Unknown { code } => {
                        text(code, 256)
                    }
                }
        }
        ServerMessage::Focus {
            version,
            focus_request_id,
            target,
        } => {
            *version == 2
                && text(focus_request_id, 256)
                && [
                    &target.event_id,
                    &target.workspace_id,
                    &target.canvas_id,
                    &target.node_id,
                    &target.execution_generation,
                ]
                .iter()
                .all(|v| text(v, 256))
        }
    };
    valid.then_some(message)
}
#[cfg(test)]
mod server_tests {
    use super::*;
    #[test]
    fn shared_server_vectors_and_serialization() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/attention-protocol/tests/native-server-vectors.json"
        ))
        .unwrap();
        for case in vectors.as_array().unwrap() {
            let decoded = decode_server_frame(case["frame"].as_str().unwrap().as_bytes());
            assert_eq!(
                decoded.is_some(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
            if let Some(decoded) = decoded {
                assert_eq!(
                    serde_json::to_value(decoded).unwrap(),
                    serde_json::from_str::<serde_json::Value>(case["frame"].as_str().unwrap())
                        .unwrap()
                );
            }
        }
    }
}

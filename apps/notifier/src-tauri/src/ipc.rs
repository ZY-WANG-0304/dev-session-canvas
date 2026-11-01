//! macOS development transport. Other platforms remain explicitly unsupported.
use dsc_notifier::{
    event_store::EventStore,
    protocol::{decode_frame, Operation, MAX_FRAME_BYTES},
    source_registry::SourceRegistry,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    os::{
        fd::AsRawFd,
        unix::{
            fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
static SERVER: OnceLock<Arc<Server>> = OnceLock::new();
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn private(path: &Path, directory: bool) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if m.file_type().is_symlink()
        || m.uid() != unsafe { libc::getuid() }
        || m.mode() & 0o077 != 0
        || (directory && !m.is_dir())
        || (!directory && !m.is_file())
    {
        return Err("unsafe-runtime-path".into());
    }
    Ok(())
}
struct State {
    registry: SourceRegistry,
    store: EventStore,
    writers: HashMap<u64, Arc<Mutex<UnixStream>>>,
    pending_focus: HashMap<String, (u64, u64)>,
}
struct Server {
    state: Mutex<State>,
    post: fn(String),
    withdraw: fn(String),
    credential: String,
}
fn write(stream: &Arc<Mutex<UnixStream>>, value: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    if bytes.len() > MAX_FRAME_BYTES
        || dsc_notifier::protocol::decode_server_frame(&bytes).is_none()
    {
        return Err("reply-too-large".into());
    }
    stream
        .lock()
        .map_err(|_| "lock")?
        .write_all(&bytes)
        .map_err(|e| e.to_string())
}
fn read_frame(reader: &mut BufReader<UnixStream>) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    loop {
        let chunk = reader.fill_buf().map_err(|e| e.to_string())?;
        if chunk.is_empty() {
            return Err("closed".into());
        }
        let count = chunk
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(chunk.len());
        if result.len() + count > MAX_FRAME_BYTES {
            return Err("frame-too-large".into());
        }
        result.extend_from_slice(&chunk[..count]);
        reader.consume(count);
        if result.last() == Some(&b'\n') {
            return Ok(result);
        }
    }
}
pub fn start(post: fn(String), withdraw: fn(String)) -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or("missing-home")?;
    let root = PathBuf::from(home).join(".dsc-notifier");
    for dir in [&root, &root.join("runtime")] {
        if !dir.exists() {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(dir)
                .map_err(|e| e.to_string())?;
        }
        private(dir, true)?;
    }
    let dir = root.join("runtime");
    let lock_path = dir.join("lock");
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&lock_path)
        .map_err(|e| e.to_string())?;
    private(&lock_path, false)?;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("notifier-already-running".into());
    }
    for name in ["events.json", "events.pending", "credential"] {
        let path = dir.join(name);
        if path.exists() {
            private(&path, false)?;
        }
    }
    let pending = dir.join("events.pending");
    if pending.exists() {
        fs::remove_file(pending).map_err(|e| e.to_string())?;
    }
    let credential = token()?;
    let credential_path = dir.join("credential");
    let mut cred = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&credential_path)
        .map_err(|e| e.to_string())?;
    cred.write_all(credential.as_bytes())
        .and_then(|_| cred.sync_all())
        .map_err(|e| e.to_string())?;
    let socket = dir.join("notifier.sock");
    if socket.as_os_str().len() >= 104 {
        return Err("socket-path-too-long".into());
    }
    if let Ok(m) = fs::symlink_metadata(&socket) {
        use std::os::unix::fs::FileTypeExt;
        if !m.file_type().is_socket() || m.uid() != unsafe { libc::getuid() } {
            return Err("unsafe-socket".into());
        }
        fs::remove_file(&socket).map_err(|e| e.to_string())?;
    }
    let listener = UnixListener::bind(&socket).map_err(|e| e.to_string())?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    let server = Arc::new(Server {
        state: Mutex::new(State {
            registry: SourceRegistry::default(),
            store: EventStore::open(dir.join("events.json"))?,
            writers: HashMap::new(),
            pending_focus: HashMap::new(),
        }),
        post,
        withdraw,
        credential,
    });
    SERVER
        .set(server.clone())
        .map_err(|_| "already-initialized")?;
    std::thread::spawn(move || {
        let _lock = lock;
        let next = AtomicU64::new(1);
        let count = Arc::new(AtomicUsize::new(0));
        for stream in listener.incoming().flatten() {
            if count.fetch_add(1, Ordering::SeqCst) >= 16 {
                count.fetch_sub(1, Ordering::SeqCst);
                continue;
            }
            let id = next.fetch_add(1, Ordering::SeqCst);
            let server = server.clone();
            let count = count.clone();
            std::thread::spawn(move || {
                server.connection(id, stream);
                count.fetch_sub(1, Ordering::SeqCst);
            });
        }
    });
    Ok(())
}
impl Server {
    fn connection(&self, id: u64, stream: UnixStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
        let Ok(clone) = stream.try_clone() else {
            return;
        };
        let writer = Arc::new(Mutex::new(clone));
        let mut reader = BufReader::new(stream);
        let mut identity: Option<String> = None;
        while let Ok(frame) = read_frame(&mut reader) {
            let Some(request) = decode_frame(&frame, now()) else {
                break;
            };
            if request.credential != self.credential {
                break;
            }
            if identity
                .as_ref()
                .is_some_and(|source| source != &request.source_instance_id)
            {
                break;
            }
            let result = (|| -> Result<Value, String> {
                let mut state = self.state.lock().map_err(|_| "state-lock")?;
                if let Operation::Register { workspace_id, .. } = &request.operation {
                    state
                        .registry
                        .register(request.source_instance_id.clone(), id, workspace_id.clone())
                        .map_err(|_| "registration-conflict")?;
                    state.writers.insert(id, writer.clone());
                    identity = Some(request.source_instance_id.clone());
                    return Ok(json!({"status":"accepted"}));
                }
                if identity.is_none() {
                    return Err("not-registered".into());
                }
                let source = &request.source_instance_id;
                match &request.operation {
                    Operation::Publish { event } => {
                        // Registry validates source/workspace before any durable side effect.
                        let route_token = state
                            .store
                            .query(source, &event.event_id)
                            .map(|r| r.token.clone())
                            .unwrap_or(token()?);
                        state
                            .registry
                            .validate_event(id, source, &route_token, event, now())
                            .map_err(|_| "invalid-route")?;
                        let saved =
                            state
                                .store
                                .publish(source, route_token.clone(), event.clone(), now());
                        let (saved, is_new) = saved?;
                        if !saved.withdrawn {
                            state
                                .registry
                                .track_persisted_event(
                                    id,
                                    source,
                                    route_token.clone(),
                                    event.clone(),
                                    now(),
                                )
                                .map_err(|_| "commit-unknown")?;
                        }
                        if is_new {
                            let payload=json!({"id":route_token,"title":event.title,"body":event.body,"playSound":event.play_sound}).to_string();
                            // Accepted data survives even when native delivery fails; no workbench double-post.
                            (self.post)(payload);
                        }
                        Ok(
                            json!({"status":"accepted","eventState":if saved.withdrawn{"withdrawn"}else{"stored"}}),
                        )
                    }
                    Operation::Query { event_id } => Ok(
                        json!({"status":"accepted","eventState":state.store.query(source,event_id).map(|r|if r.withdrawn{"withdrawn"}else{"stored"}).unwrap_or("absent")}),
                    ),
                    Operation::Withdraw { event_id } => {
                        if let Some(token) = state.store.withdraw(source, event_id)? {
                            state
                                .registry
                                .withdraw(id, source, event_id)
                                .map_err(|_| "invalid-source")?;
                            (self.withdraw)(token);
                        }
                        Ok(json!({"status":"accepted"}))
                    }
                    Operation::Sync { event_ids } => {
                        let records = state.store.active(source, now());
                        for record in records {
                            if event_ids.contains(&record.event.event_id) {
                                state
                                    .registry
                                    .track_persisted_event(
                                        id,
                                        source,
                                        record.token,
                                        record.event,
                                        now(),
                                    )
                                    .map_err(|_| "sync-route-conflict")?;
                            } else {
                                state.store.withdraw(source, &record.event.event_id)?;
                                let _ = state.registry.withdraw(id, source, &record.event.event_id);
                                let token = record.token;
                                (self.withdraw)(token);
                            }
                        }
                        Ok(json!({"status":"accepted"}))
                    }
                    Operation::FocusResult {
                        focus_request_id,
                        result,
                    } => {
                        state
                            .pending_focus
                            .retain(|_, (_, deadline)| *deadline > now());
                        if state
                            .pending_focus
                            .get(focus_request_id)
                            .map(|(connection, _)| *connection)
                            != Some(id)
                        {
                            return Err("unknown-focus-request".into());
                        }
                        state.pending_focus.remove(focus_request_id);
                        crate::record(&format!("source-focus-result result={result}"));
                        Ok(json!({"status":"accepted"}))
                    }
                    Operation::Update {
                        event_id,
                        title,
                        body,
                    } => {
                        state
                            .store
                            .update(source, event_id, title.clone(), body.clone(), now())?;
                        // Content edits update history without re-alerting the OS.
                        Ok(json!({"status":"accepted"}))
                    }
                    Operation::Register { .. } => unreachable!(),
                }
            })();
            let result=result.unwrap_or_else(|code|json!({"status":if code=="commit-unknown"{"unknown"}else{"rejected"},"code":if code.bytes().all(|b| b.is_ascii_lowercase() || b==b'-'){code}else{"storage-error".into()}}));
            if write(&writer,json!({"version":2,"type":"receipt","requestId":request.request_id,"result":result})).is_err(){break;}
        }
        if let Ok(mut state) = self.state.lock() {
            state.registry.disconnect(id);
            state.writers.remove(&id);
            state
                .pending_focus
                .retain(|_, (connection, _)| *connection != id);
        }
    }
}
pub fn focus(token: &str) -> bool {
    let Some(server) = SERVER.get() else {
        return false;
    };
    let Ok(mut state) = server.state.lock() else {
        return false;
    };
    let Ok(target) = state.registry.focus(token, now()) else {
        return false;
    };
    let Some(writer) = state.writers.get(&target.connection_id).cloned() else {
        return false;
    };
    state
        .pending_focus
        .retain(|_, (_, deadline)| *deadline > now());
    if state.pending_focus.len() >= 256 {
        return false;
    }
    let Ok(focus_id) = self::token() else {
        return false;
    };
    state
        .pending_focus
        .insert(focus_id.clone(), (target.connection_id, now() + 10000));
    drop(state);
    let event = target.event;
    write(&writer,json!({"version":2,"type":"focus-node","focusRequestId":focus_id,"target":{"eventId":event.event_id,"workspaceId":event.workspace_id,"canvasId":event.canvas_id,"nodeId":event.node_id,"executionGeneration":event.execution_generation}})).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn server() -> (Arc<Server>, PathBuf) {
        let dir = std::env::temp_dir().join(format!("dsc-ipc-{}", token().unwrap()));
        fs::create_dir(&dir).unwrap();
        (
            Arc::new(Server {
                state: Mutex::new(State {
                    registry: SourceRegistry::default(),
                    store: EventStore::open(dir.join("events.json")).unwrap(),
                    writers: HashMap::new(),
                    pending_focus: HashMap::new(),
                }),
                post: |_| {},
                withdraw: |_| {},
                credential: "a".repeat(64),
            }),
            dir,
        )
    }
    fn connect(
        server: Arc<Server>,
        id: u64,
    ) -> (BufReader<UnixStream>, std::thread::JoinHandle<()>) {
        let (client, peer) = UnixStream::pair().unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let thread = std::thread::spawn(move || server.connection(id, peer));
        (BufReader::new(client), thread)
    }
    fn send(client: &mut BufReader<UnixStream>, source: &str, operation: Value) -> Value {
        let request = json!({"version":2,"requestId":"r","credential":"a".repeat(64),"sourceInstanceId":source,"operation":operation});
        client
            .get_mut()
            .write_all(format!("{request}\n").as_bytes())
            .unwrap();
        serde_json::from_slice(&read_frame(client).unwrap()).unwrap()
    }
    fn register(client: &mut BufReader<UnixStream>, source: &str) {
        assert_eq!(
            send(
                client,
                source,
                json!({"type":"register","workspaceId":"w","capabilities":["focus-node"]})
            )["result"]["status"],
            "accepted"
        );
    }
    #[test]
    fn transport_auth_bounds_dedupe_and_isolated_routes() {
        let (server, dir) = server();
        let (mut a, ta) = connect(server.clone(), 1);
        let (mut b, tb) = connect(server.clone(), 2);
        register(&mut a, "a");
        register(&mut b, "b");
        let event = json!({"eventId":"same","workspaceId":"w","canvasId":"c","nodeId":"n","executionGeneration":"g","occurredAt":now(),"expiresAt":now()+60000,"mergeKey":"k","title":"same title","body":"body","playSound":false});
        assert_eq!(
            send(&mut a, "a", json!({"type":"publish","event":event}))["result"]["status"],
            "accepted"
        );
        assert_eq!(
            send(&mut b, "b", json!({"type":"publish","event":event}))["result"]["status"],
            "accepted"
        );
        assert_eq!(
            send(&mut a, "a", json!({"type":"publish","event":event}))["result"]["status"],
            "accepted"
        );
        let (token_a, token_b) = {
            let s = server.state.lock().unwrap();
            (
                s.store.query("a", "same").unwrap().token.clone(),
                s.store.query("b", "same").unwrap().token.clone(),
            )
        };
        assert_ne!(token_a, token_b);
        assert_eq!(
            server
                .state
                .lock()
                .unwrap()
                .registry
                .focus(&token_a, now())
                .unwrap()
                .connection_id,
            1
        );
        send(&mut a, "a", json!({"type":"sync","eventIds":[]}));
        assert!(server
            .state
            .lock()
            .unwrap()
            .registry
            .focus(&token_a, now())
            .is_err());
        assert_eq!(
            server
                .state
                .lock()
                .unwrap()
                .registry
                .focus(&token_b, now())
                .unwrap()
                .connection_id,
            2
        );
        assert_eq!(
            send(
                &mut a,
                "a",
                json!({"type":"focusResult","focusRequestId":"forged","result":"focused"})
            )["result"]["status"],
            "rejected"
        );
        drop(a);
        ta.join().unwrap();
        drop(b);
        tb.join().unwrap();
        assert!(server
            .state
            .lock()
            .unwrap()
            .registry
            .focus(&token_b, now())
            .is_err());
        let (mut bad, tbad) = connect(server.clone(), 3);
        bad.get_mut().write_all(format!("{}\n",json!({"version":2,"requestId":"r","credential":"b".repeat(64),"sourceInstanceId":"evil","operation":{"type":"register","workspaceId":"w","capabilities":["focus-node"]}})).as_bytes()).unwrap();
        assert!(read_frame(&mut bad).is_err());
        drop(bad);
        tbad.join().unwrap();
        let (mut huge, thuge) = connect(server, 4);
        huge.get_mut()
            .write_all(&vec![b'x'; MAX_FRAME_BYTES + 1])
            .unwrap();
        assert!(read_frame(&mut huge).is_err());
        drop(huge);
        thuge.join().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn fragmented_frames_stay_bounded() {
        let (client, mut peer) = UnixStream::pair().unwrap();
        let thread = std::thread::spawn(move || {
            peer.write_all(b"{\"version\":").unwrap();
            peer.write_all(b"2}\nsecond\n").unwrap();
        });
        let mut reader = BufReader::with_capacity(3, client);
        assert_eq!(read_frame(&mut reader).unwrap(), b"{\"version\":2}\n");
        assert_eq!(read_frame(&mut reader).unwrap(), b"second\n");
        thread.join().unwrap();
    }
}

pub fn connection_count() -> usize {
    SERVER
        .get()
        .and_then(|server| server.state.lock().ok().map(|state| state.writers.len()))
        .unwrap_or(0)
}

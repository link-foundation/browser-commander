//! Bounded HTTP fixture that tolerates Firefox speculative connections.
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
    task::{JoinHandle, JoinSet},
    time::{timeout, Duration},
};
pub async fn start() -> anyhow::Result<(String, oneshot::Sender<()>, JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let (stop, mut closing) = oneshot::channel();
    let server = tokio::spawn(async move {
        let mut tasks = JoinSet::new();
        loop {
            tokio::select! {
                _=&mut closing=>break,
                _=tasks.join_next(),if !tasks.is_empty()=>{},
                accepted=listener.accept()=> {
                    let Ok((mut socket,_))=accepted else {break;};
                    if tasks.len()>=32 {continue;}
                    tasks.spawn(async move {
                        let mut request=[0;4096];
                        if let Ok(Ok(_))=timeout(Duration::from_secs(2),socket.read(&mut request)).await {
                            let _=socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\n<title>state").await;
                        }
                    });
                }
            }
        }
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    });
    Ok((origin, stop, server))
}

//! A tiny HTTP/1.1 reader and writer for the local Claude connector (AI-2). Only what Claude
//! Code's Streamable HTTP transport needs: one POST with a JSON body per connection.
//! Kept free of Tauri so it can be tested on its own.

use std::io::{BufRead, BufReader, Read, Write};

pub const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Debug, Default, PartialEq)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub host: String,
    pub origin: Option<String>,
    pub authorization: String,
    pub body: String,
}

/// Read one request (request line, headers, Content-Length body).
pub fn read_request<R: Read>(stream: R) -> Result<Request, String> {
    let mut r = BufReader::new(stream);
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.split_whitespace();
    let mut req = Request {
        method: parts.next().unwrap_or("").to_string(),
        path: parts.next().unwrap_or("").to_string(),
        ..Default::default()
    };
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            let v = v.trim().to_string();
            match k.trim().to_ascii_lowercase().as_str() {
                "content-length" => len = v.parse().map_err(|_| "bad Content-Length".to_string())?,
                "host" => req.host = v,
                "origin" => req.origin = Some(v),
                "authorization" => req.authorization = v,
                _ => {}
            }
        }
    }
    if len > MAX_BODY {
        return Err("body too large".into());
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).map_err(|e| e.to_string())?;
    req.body = String::from_utf8(body).map_err(|_| "body is not UTF-8".to_string())?;
    Ok(req)
}

/// Only Claude Code on this computer may call: the Host must be the loopback address (a web page
/// cannot rebind a name to it) and browsers, which always send an Origin, are turned away.
pub fn allowed(req: &Request, port: u16) -> Result<(), (u16, &'static str)> {
    let host_ok = req.host == format!("127.0.0.1:{port}") || req.host == format!("localhost:{port}");
    if !host_ok {
        return Err((403, "Forbidden host"));
    }
    if req.origin.as_deref().is_some_and(|o| o != "null") {
        return Err((403, "Browsers may not call the story world connector"));
    }
    if req.path != "/mcp" && !req.path.starts_with("/mcp?") {
        return Err((404, "Not found"));
    }
    if req.method != "POST" {
        return Err((405, "Method not allowed"));
    }
    Ok(())
}

pub fn write_response<W: Write>(mut w: W, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    };
    let ctype = if body.starts_with('{') || body.starts_with('[') { "application/json" } else { "text/plain; charset=utf-8" };
    let allow = if status == 405 { "Allow: POST\r\n" } else { "" };
    write!(w, "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n{allow}Connection: close\r\n\r\n{body}", body.len())?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_post() {
        let raw = b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:47820\r\nAuthorization: Bearer abc\r\nContent-Type: application/json\r\nContent-Length: 15\r\n\r\n{\"jsonrpc\":1}xx";
        let r = read_request(&raw[..]).unwrap();
        assert_eq!(r.method, "POST");
        assert_eq!(r.path, "/mcp");
        assert_eq!(r.authorization, "Bearer abc");
        assert_eq!(r.body, "{\"jsonrpc\":1}xx");
        assert!(allowed(&r, 47820).is_ok());
        assert_eq!(allowed(&r, 1).unwrap_err().0, 403);
    }

    #[test]
    fn turns_browsers_and_other_paths_away() {
        let mut r = Request { method: "POST".into(), path: "/mcp".into(), host: "localhost:5".into(), origin: Some("https://evil.example".into()), ..Default::default() };
        assert_eq!(allowed(&r, 5).unwrap_err().0, 403);
        r.origin = None;
        r.method = "GET".into();
        assert_eq!(allowed(&r, 5).unwrap_err().0, 405);
        r.path = "/x".into();
        assert_eq!(allowed(&r, 5).unwrap_err().0, 404);
    }

    #[test]
    fn writes_json_and_empty_answers() {
        let mut out = Vec::new();
        write_response(&mut out, 200, "{}").unwrap();
        let s = String::from_utf8(out).unwrap();
        assert!(s.starts_with("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n"));
        let mut out = Vec::new();
        write_response(&mut out, 202, "").unwrap();
        assert!(String::from_utf8(out).unwrap().contains("202 Accepted"));
    }
}

//! Opt-in EventKit adapter. No authorization request is made by status or sync.
use chrono::{DateTime, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    id: String,
    title: String,
    start: String,
    end: Option<String>,
    all_day: bool,
    time_zone: String,
    notes: String,
    location: String,
    url: String,
    #[serde(default)]
    meeting_info: String,
    status: String,
    reminder_minutes: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    workspace_key: String,
    calendar_id: String,
    items: Vec<Item>,
    revision: String,
}
#[derive(Default, Deserialize, Serialize)]
struct Bindings {
    entries: BTreeMap<String, Binding>,
}
#[derive(Deserialize, Serialize)]
struct Binding {
    event_id: String,
    calendar_id: String,
    marker: String,
    snapshot: Value,
    #[serde(default)]
    source: Value,
}
fn check_binding(
    b: &Binding,
    calendar: &str,
    marker: &str,
    notes: &str,
    snapshot: &Value,
) -> Result<(), String> {
    if b.calendar_id != calendar || b.marker != marker {
        return Err("绑定属于其他日历，请先处理原绑定".into());
    }
    let mut expected = b.snapshot.as_object().cloned().ok_or("日历绑定内容无效")?;
    let mut actual = snapshot.as_object().cloned().ok_or("系统日历内容无效")?;
    // EventKit/iCloud can update modification metadata without changing the
    // event. Compare the content we own, including URL, time zone and alarms.
    expected.remove("modified");
    actual.remove("modified");
    for key in ["url", "timeZone"] {
        if actual.contains_key(key) && !expected.contains_key(key) {
            let value = b.source.get(key).filter(|value| value.is_string())
                .ok_or("旧日历绑定缺少完整内容，请核对后处理")?;
            expected.insert(key.into(), value.clone());
        }
    }
    if actual.contains_key("alarms") && !expected.contains_key("alarms") {
        let value = b.source.get("reminderMinutes")
            .ok_or("旧日历绑定缺少提醒信息，请核对后处理")?;
        let alarms = if value.is_null() {
            json!([])
        } else {
            let minutes = value.as_i64().ok_or("旧日历绑定提醒信息无效")?;
            json!([{"relative":-(minutes as f64)*60.,"absolute":null}])
        };
        expected.insert("alarms".into(), alarms);
    }
    if !notes.ends_with(marker) || expected != actual {
        return Err("系统事件已被外部修改，保留双方内容并请人工核对".into());
    }
    Ok(())
}
fn denied_results(items: Vec<Item>) -> Vec<Value> {
    items.into_iter().map(|i| json!({"id":i.id,"ok":false,"operation":"blocked","error":"需要完整日历权限，请主动连接日历"})).collect()
}
fn calendar_notes(i: &Item, marker: &str) -> String {
    let mut notes = i.notes.clone();
    if !i.meeting_info.is_empty() {
        if !notes.is_empty() {
            notes.push_str("\n\n");
        }
        notes.push_str("入会信息：");
        notes.push_str(&i.meeting_info);
    }
    format!("{notes}\n{marker}")
}
fn authorization_request_needed(action: &str, status: i64) -> bool {
    // Permission is stored by macOS, not an App preference. Only an explicit
    // initial request or write-only upgrade should call the permission API.
    action == "authorize" && matches!(status, 0 | 4)
}
fn valid_item_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b':' | b'-'))
}
fn valid_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn times(i: &Item) -> Result<(f64, f64), String> {
    let zone: chrono_tz::Tz = i.time_zone.parse().map_err(|_| "无效时区")?;
    let parse = |s: &str| -> Result<f64, String> {
        if i.all_day {
            let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "全天日期格式无效")?;
            if d.format("%Y-%m-%d").to_string() != s {
                return Err("全天日期格式无效".into());
            }
            Ok(zone
                .from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                .single()
                .ok_or("日期在此时区有歧义")?
                .timestamp() as f64)
        } else {
            Ok(DateTime::parse_from_rfc3339(s)
                .map_err(|_| "时间必须包含时区")?
                .timestamp_millis() as f64
                / 1000.)
        }
    };
    let start = parse(&i.start)?;
    let end = match &i.end {
        Some(e) => parse(e)?,
        None if i.all_day => {
            let d = NaiveDate::parse_from_str(&i.start, "%Y-%m-%d")
                .map_err(|_| "日期无效")?
                .succ_opt()
                .ok_or("日期越界")?;
            parse(&d.to_string())?
        }
        None => return Err("同步到系统日历需要明确结束时间".into()),
    };
    if end <= start {
        return Err("结束时间必须晚于开始时间".into());
    }
    Ok((start, end))
}
fn validate_sync_time(i: &Item) -> Result<(), String> {
    // Removing an owned binding does not require a date in the current source.
    // The original saved event and ownership check still govern the deletion.
    if i.status != "cancelled" {
        times(i)?;
    }
    Ok(())
}
fn validate(r: &Request) -> Result<(), String> {
    if !valid_key(&r.workspace_key)
        || r.calendar_id.is_empty()
        || r.calendar_id.len() > 512
        || r.items.len() > 1000
        || r.revision.len() > 128
    {
        return Err("日历请求超出范围".into());
    }
    let mut ids = HashSet::new();
    for i in &r.items {
        if !valid_item_id(&i.id)
            || !ids.insert(&i.id)
            || i.title.trim().is_empty()
            || i.title.chars().count() > 512
            || i.notes.chars().count() > 30000
            || i.location.chars().count() > 2048
            || i.url.chars().count() > 2048
            || i.meeting_info.chars().count() > 2048
            || !matches!(i.status.as_str(), "planned" | "completed" | "cancelled")
            || i.reminder_minutes
                .is_some_and(|n| !(0..=43200).contains(&n))
        {
            return Err("日程字段无效或重复".into());
        }
        if !i.url.is_empty() {
            let u = reqwest::Url::parse(&i.url).map_err(|_| "链接无效")?;
            if !matches!(u.scheme(), "https" | "http")
                || !u.username().is_empty()
                || u.password().is_some()
                || u.host_str().is_none()
            {
                return Err("仅支持不含凭据的 HTTP(S) 链接".into());
            }
        }
    }
    Ok(())
}
pub async fn calendar_action(action: String, request: Option<Value>) -> Result<Value, String> {
    if !matches!(
        action.as_str(),
        "status" | "authorize" | "calendars" | "sync"
    ) {
        return Err("未知日历操作".into());
    }
    let request = if action == "sync" {
        let r: Request = serde_json::from_value(request.ok_or("缺少同步请求")?)
            .map_err(|_| "同步请求格式无效")?;
        validate(&r)?;
        Some(r)
    } else {
        None
    };
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || native::run(&action, request))
        .await
        .map_err(|_| "日历任务未完成".to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        Ok(
            json!({"supported":false,"authorization":"unavailable","error":"此平台暂不支持原生日历"}),
        )
    }
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2::{
        class, msg_send,
        rc::Retained,
        runtime::{AnyObject, Bool},
        sel,
    };
    use objc2_foundation::NSString;
    use std::{path::PathBuf, sync::Mutex};
    #[link(name = "EventKit", kind = "framework")]
    unsafe extern "C" {}
    static LOCK: Mutex<()> = Mutex::new(());
    fn string(s: &str) -> Retained<NSString> {
        NSString::from_str(s)
    }
    unsafe fn text(o: *mut AnyObject) -> String {
        if o.is_null() {
            return String::new();
        }
        let p: *const std::ffi::c_char = msg_send![o, UTF8String];
        if p.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()
        }
    }
    unsafe fn field(o: &AnyObject, selector: objc2::runtime::Sel) -> String {
        let p: *mut AnyObject = objc2::msg_send![o,performSelector:selector];
        text(p)
    }
    unsafe fn auth() -> i64 {
        msg_send![class!(EKEventStore),authorizationStatusForEntityType:0_isize]
    }
    fn auth_name(n: i64) -> &'static str {
        match n {
            0 => "notDetermined",
            1 => "restricted",
            2 => "denied",
            3 => "fullAccess",
            4 => "writeOnly",
            _ => "unknown",
        }
    }
    unsafe fn date(t: f64) -> Retained<AnyObject> {
        msg_send![class!(NSDate),dateWithTimeIntervalSince1970:t]
    }
    unsafe fn snapshot(e: &AnyObject) -> Value {
        let start: *mut AnyObject = msg_send![e, startDate];
        let end: *mut AnyObject = msg_send![e, endDate];
        let s: f64 = msg_send![start, timeIntervalSince1970];
        let t: f64 = msg_send![end, timeIntervalSince1970];
        let all: Bool = msg_send![e, isAllDay];
        let cal: *mut AnyObject = msg_send![e, calendar];
        let url: *mut AnyObject = msg_send![e, URL];
        let url = if url.is_null() { String::new() } else { text(msg_send![url, absoluteString]) };
        let zone: *mut AnyObject = msg_send![e, timeZone];
        let zone = if zone.is_null() { String::new() } else { text(msg_send![zone, name]) };
        let native_alarms: *mut AnyObject = msg_send![e, alarms];
        let mut alarms = Vec::new();
        if !native_alarms.is_null() {
            let count: usize = msg_send![native_alarms, count];
            for idx in 0..count {
                let alarm: *mut AnyObject = msg_send![native_alarms, objectAtIndex:idx];
                let relative: f64 = msg_send![alarm, relativeOffset];
                let date: *mut AnyObject = msg_send![alarm, absoluteDate];
                let absolute: Option<f64> = if date.is_null() { None } else { Some(msg_send![date, timeIntervalSince1970]) };
                alarms.push(json!({"relative":relative,"absolute":absolute}));
            }
            alarms.sort_by_key(Value::to_string);
        }
        json!({"title":field(e,sel!(title)),"notes":field(e,sel!(notes)),"location":field(e,sel!(location)),"start":s,"end":t,"allDay":all.as_bool(),"calendar":text(msg_send![cal,calendarIdentifier]),"url":url,"timeZone":zone,"alarms":alarms})
    }
    fn path(key: &str) -> Result<PathBuf, String> {
        if let Some(root) = std::env::var_os("TOUDI_APP_HOME") {
            return Ok(PathBuf::from(root).join("calendar-bindings").join(format!("{key}.json")));
        }
        let home = std::env::var_os("HOME").ok_or("无法读取本机资料位置")?;
        Ok(PathBuf::from(home)
            .join("Library/Application Support/TouDi/calendar-bindings")
            .join(format!("{key}.json")))
    }
    fn persist(p: &std::path::Path, b: &Bindings) -> Result<(), String> {
        std::fs::create_dir_all(p.parent().unwrap()).map_err(|_| "无法保存日历绑定")?;
        let tmp = p.with_extension("tmp");
        let bytes = serde_json::to_vec(b).map_err(|_| "绑定编码失败")?;
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        use std::os::unix::fs::OpenOptionsExt;
        options.write(true).create(true).truncate(true).mode(0o600);
        let mut f = options.open(&tmp).map_err(|_| "无法保存日历绑定")?;
        f.write_all(&bytes)
            .and_then(|_| f.sync_all())
            .map_err(|_| "无法保存日历绑定")?;
        std::fs::rename(tmp, p).map_err(|_| "无法保存日历绑定".to_string())
    }
    pub fn run(action: &str, r: Option<Request>) -> Result<Value, String> {
        let _guard = LOCK.lock().map_err(|_| "日历同步忙")?;
        objc2::rc::autoreleasepool(|_| unsafe {
            let store: Retained<AnyObject> = msg_send![class!(EKEventStore), new];
            if authorization_request_needed(action, auth()) {
                let (tx, rx) = std::sync::mpsc::channel();
                let completion =
                    block2::RcBlock::new(move |granted: Bool, error: *mut AnyObject| {
                        let message = if error.is_null() { None } else { Some(text(msg_send![error, localizedDescription])) };
                        let _ = tx.send((granted.as_bool(), message));
                    });
                let modern: Bool = msg_send![&*store,respondsToSelector:sel!(requestFullAccessToEventsWithCompletion:)];
                if modern.as_bool() {
                    let _: () =
                        msg_send![&*store,requestFullAccessToEventsWithCompletion:&*completion];
                } else {
                    let _: () = msg_send![&*store,requestAccessToEntityType:0_isize,completion:&*completion];
                }
                let (granted, error) = rx.recv_timeout(std::time::Duration::from_secs(120))
                    .map_err(|_| "等待日历授权超时，请重新检查权限状态")?;
                if let Some(error) = error {
                    return Ok(json!({"supported":true,"authorization":auth_name(auth()),"granted":granted,"error":error}));
                }
                if !granted && auth() == 0 {
                    return Ok(json!({"supported":true,"authorization":"notDetermined","granted":false,"error":"macOS 未完成日历授权，请检查系统提示；若没有提示，请更新 App 后重试。"}));
                }
                // Refresh this store after the OS changes authorization. Never
                // carry pre-authorization event caches into the authorized read.
                if granted { let _: () = msg_send![&*store, reset]; }
            }
            let authorization = auth_name(auth());
            if matches!(action, "status" | "authorize") {
                return Ok(json!({"supported":true,"authorization":authorization}));
            }
            if authorization != "fullAccess" {
                let results = r.map(|r| denied_results(r.items)).unwrap_or_default();
                return Ok(
                    json!({"supported":true,"authorization":authorization,"calendars":[],"results":results}),
                );
            }
            let calendars: Retained<AnyObject> = msg_send![&*store,calendarsForEntityType:0_isize];
            let count: usize = msg_send![&*calendars, count];
            let mut writable = Vec::new();
            for idx in 0..count {
                let c: *mut AnyObject = msg_send![&*calendars,objectAtIndex:idx];
                let write: Bool = msg_send![c, allowsContentModifications];
                if write.as_bool() {
                    writable.push(json!({"id":text(msg_send![c,calendarIdentifier]),"title":text(msg_send![c,title])}));
                }
            }
            if action == "calendars" {
                return Ok(
                    json!({"supported":true,"authorization":authorization,"calendars":writable}),
                );
            }
            let r = r.unwrap();
            let p = path(&r.workspace_key)?;
            let mut bindings: Bindings = match std::fs::read(&p) {
                Ok(b) => {
                    if b.len() > 4_000_000 {
                        return Err("日历绑定文件过大".into());
                    }
                    serde_json::from_slice(&b).map_err(|_| "日历绑定文件损坏，请保留资料并检查")?
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Bindings::default(),
                Err(_) => return Err("无法读取日历绑定".into()),
            };
            persist(&p, &bindings)?;
            let calendar: Option<Retained<AnyObject>> =
                msg_send![&*store,calendarWithIdentifier:&*string(&r.calendar_id)];
            let mut results = Vec::new();
            for i in r.items {
                let result = (|| -> Result<Value, String> {
                    validate_sync_time(&i)?;
                    let c = calendar.as_ref().ok_or("所选日历已失效")?;
                    let write: Bool = msg_send![&**c, allowsContentModifications];
                    if !write.as_bool() {
                        return Err("所选日历不可写".into());
                    }
                    let marker = format!("[TouDi:{}:{}]", r.workspace_key, i.id);
                    let bound = bindings.entries.get(&i.id);
                    let event = if let Some(b) = bound {
                        if b.calendar_id != r.calendar_id || b.marker != marker {
                            return Err("绑定属于其他日历，请先处理原绑定".into());
                        }
                        let e: Option<Retained<AnyObject>> =
                            msg_send![&*store,eventWithIdentifier:&*string(&b.event_id)];
                        let e = e.ok_or("系统事件已移除，请核对后解除绑定")?;
                        check_binding(
                            b,
                            &r.calendar_id,
                            &marker,
                            &field(&e, sel!(notes)),
                            &snapshot(&e),
                        )?;
                        e
                    } else {
                        if i.status == "cancelled" {
                            return Ok(json!({"id":i.id,"ok":true,"operation":"noop"}));
                        }
                        msg_send![class!(EKEvent),eventWithEventStore:&*store]
                    };
                    let source = serde_json::to_value(&i).map_err(|_| "日程编码失败")?;
                    if i.status != "cancelled" && bound.is_some_and(|b| b.source == source) {
                        return Ok(
                            json!({"id":i.id,"ok":true,"operation":"unchanged","eventIdentifier":field(&event,sel!(eventIdentifier))}),
                        );
                    }
                    let operation = if i.status == "cancelled" {
                        "deleted"
                    } else if bound.is_some() {
                        "updated"
                    } else {
                        "created"
                    };
                    let mut error: *mut AnyObject = std::ptr::null_mut();
                    let ok: Bool = if i.status == "cancelled" {
                        msg_send![&*store,removeEvent:&*event,span:0_isize,commit:Bool::YES,error:&mut error]
                    } else {
                        let (start, end) = times(&i)?;
                        let _: () = msg_send![&*event,setCalendar:&**c];
                        let _: () = msg_send![&*event,setTitle:&*string(&i.title)];
                        let _: () = msg_send![&*event,setStartDate:&*date(start)];
                        let _: () = msg_send![&*event,setEndDate:&*date(end)];
                        let _: () = msg_send![&*event,setAllDay:Bool::from(i.all_day)];
                        let zone: Retained<AnyObject> =
                            msg_send![class!(NSTimeZone),timeZoneWithName:&*string(&i.time_zone)];
                        let _: () = msg_send![&*event,setTimeZone:&*zone];
                        let _: () =
                            msg_send![&*event,setNotes:&*string(&calendar_notes(&i,&marker))];
                        let _: () = msg_send![&*event,setLocation:&*string(&i.location)];
                        let url: Option<Retained<AnyObject>> = if i.url.is_empty() {
                            None
                        } else {
                            msg_send![class!(NSURL),URLWithString:&*string(&i.url)]
                        };
                        let _: () = msg_send![&*event,setURL:url.as_deref()];
                        let alarms: Retained<AnyObject> = msg_send![class!(NSArray), array];
                        let _: () = msg_send![&*event,setAlarms:&*alarms];
                        if let Some(n) = i.reminder_minutes {
                            let alarm: Retained<AnyObject> =
                                msg_send![class!(EKAlarm),alarmWithRelativeOffset:-(n as f64)*60.];
                            let _: () = msg_send![&*event,addAlarm:&*alarm];
                        }
                        msg_send![&*store,saveEvent:&*event,span:0_isize,commit:Bool::YES,error:&mut error]
                    };
                    if !ok.as_bool() {
                        return Err(if error.is_null() {
                            "系统日历保存失败".into()
                        } else {
                            text(msg_send![error, localizedDescription])
                        });
                    }
                    let event_id = field(&event, sel!(eventIdentifier));
                    if i.status == "cancelled" {
                        bindings.entries.remove(&i.id);
                    } else {
                        bindings.entries.insert(
                            i.id.clone(),
                            Binding {
                                event_id: event_id.clone(),
                                calendar_id: r.calendar_id.clone(),
                                marker,
                                source,
                                snapshot: {let saved: Option<Retained<AnyObject>> = msg_send![&*store, eventWithIdentifier: &*string(&event_id)]; snapshot(saved.as_deref().unwrap_or(&event))},
                            },
                        );
                    }
                    persist(&p, &bindings)?;
                    Ok(
                        json!({"id":i.id,"ok":true,"operation":operation,"eventIdentifier":event_id}),
                    )
                })();
                results.push(result.unwrap_or_else(
                    |error| json!({"id":i.id,"ok":false,"operation":"blocked","error":error}),
                ));
            }
            Ok(
                json!({"supported":true,"authorization":authorization,"revision":r.revision,"results":results}),
            )
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn item() -> Item {
        serde_json::from_value(json!({"id":"synthetic_1","title":"示例","start":"2026-10-10","end":null,"allDay":true,"timeZone":"Asia/Shanghai","notes":"","location":"","url":"","status":"planned","reminderMinutes":15})).unwrap()
    }
    #[test]
    fn cancelled_items_do_not_require_dates_to_remove_the_owned_binding() {
        let mut i = item();
        i.start.clear();
        i.all_day = false;
        assert!(validate_sync_time(&i).is_err());
        i.status = "cancelled".into();
        assert!(validate_sync_time(&i).is_ok());
    }
    #[test]
    fn meeting_information_is_plain_text_and_preserves_full_notes() {
        let mut i = item();
        assert!(i.meeting_info.is_empty(), "Older requests without meetingInfo remain supported");
        i.notes = "完整备注\n保留第二行。".into();
        let marker = "[TouDi:synthetic:synthetic_1]";
        assert_eq!(calendar_notes(&i, marker), format!("{}\n{marker}", i.notes));
        i.meeting_info = "123 456 789\n密码：0123".into();
        let r = Request {
            workspace_key: "synthetic".into(),
            calendar_id: "synthetic".into(),
            items: vec![i.clone()],
            revision: "1".into(),
        };
        assert!(validate(&r).is_ok());
        assert!(i.url.is_empty());
        assert_eq!(calendar_notes(&i, marker), format!("{}\n\n入会信息：{}\n{marker}", i.notes, i.meeting_info));
        i.notes.clear();
        assert_eq!(calendar_notes(&i, marker), format!("入会信息：{}\n{marker}", i.meeting_info));
    }
    #[test]
    fn meeting_info_has_its_own_boundary_and_does_not_relax_url_validation() {
        let mut r = Request {
            workspace_key: "synthetic".into(),
            calendar_id: "synthetic".into(),
            items: vec![item()],
            revision: "1".into(),
        };
        r.items[0].meeting_info = "文".repeat(2048);
        r.items[0].notes = "文".repeat(30000);
        assert!(validate(&r).is_ok());
        r.items[0].meeting_info.push('文');
        assert!(validate(&r).is_err());
        r.items[0].meeting_info = "123456789".into();
        r.items[0].url = "123456789".into();
        assert!(validate(&r).is_err());
        r.items[0].url = "https://example.invalid/join".into();
        assert!(validate(&r).is_ok());
    }
    #[test]
    fn authorization_is_idempotent_and_never_requested_by_reads_or_sync() {
        for status in 0..=5 {
            for action in ["status", "calendars", "sync"] {
                assert!(!authorization_request_needed(action, status));
            }
        }
        assert!(authorization_request_needed("authorize", 0));
        assert!(authorization_request_needed("authorize", 4));
        for status in [1, 2, 3, 5] {
            assert!(!authorization_request_needed("authorize", status));
        }
    }
    #[test]
    fn denied_path_preserves_item_identity() {
        let results = denied_results(vec![item()]);
        assert_eq!(results[0]["id"], "synthetic_1");
        assert_eq!(results[0]["ok"], false);
        assert_eq!(results[0]["operation"], "blocked");
    }
    #[test]
    fn missing_end_is_item_error_and_does_not_reject_batch() {
        let mut incomplete = item();
        incomplete.id = "event.missing:end-1".into();
        incomplete.all_day = false;
        incomplete.start = "2026-10-10T10:00:00+08:00".into();
        let r = Request {
            workspace_key: "synthetic".into(),
            calendar_id: "synthetic".into(),
            items: vec![incomplete, item()],
            revision: "1".into(),
        };
        assert!(validate(&r).is_ok());
        assert_eq!(
            times(&r.items[0]).unwrap_err(),
            "同步到系统日历需要明确结束时间"
        );
        assert!(times(&r.items[1]).is_ok());
    }
    #[test]
    fn unified_field_boundaries() {
        let mut i = item();
        i.id = "a._:-Z9".into();
        i.title = "中".repeat(512);
        i.notes = "文".repeat(30000);
        i.location = "地".repeat(2048);
        i.reminder_minutes = Some(43200);
        let mut r = Request {
            workspace_key: "synthetic".into(),
            calendar_id: "synthetic".into(),
            items: vec![i],
            revision: "1".into(),
        };
        assert!(validate(&r).is_ok());
        r.items[0].title.push('中');
        assert!(validate(&r).is_err());
        assert!(!valid_item_id("_wrong"));
        assert!(!valid_item_id("../wrong"));
        assert!(!valid_item_id("a/b"));
    }
    #[test]
    fn exclusive_end() {
        let (s, e) = times(&item()).unwrap();
        assert_eq!(e - s, 86400.);
    }
    #[test]
    fn rejects_invalid_dates() {
        let mut i = item();
        i.start = "2026-02-30".into();
        assert!(times(&i).is_err());
        i.start = "2026-10-10T10:00:00".into();
        i.all_day = false;
        assert!(times(&i).is_err());
    }
    #[test]
    fn rejects_scope_and_duplicates() {
        let i = item();
        let r = Request {
            workspace_key: "../outside".into(),
            calendar_id: "synthetic".into(),
            items: vec![i.clone()],
            revision: "1".into(),
        };
        assert!(validate(&r).is_err());
        let mut r = Request {
            workspace_key: "synthetic".into(),
            ..r
        };
        r.items.push(i);
        assert!(validate(&r).is_err());
    }
    #[test]
    fn rejects_unsafe_links() {
        let mut i = item();
        i.url = "file:///tmp/example".into();
        let r = Request {
            workspace_key: "synthetic".into(),
            calendar_id: "synthetic".into(),
            items: vec![i],
            revision: "1".into(),
        };
        assert!(validate(&r).is_err());
    }
    #[test]
    fn binding_roundtrip_preserves_conflict_evidence() {
        let b = Binding {
            event_id: "synthetic".into(),
            calendar_id: "example".into(),
            marker: "[TouDi:example:synthetic]".into(),
            snapshot: json!({"title":"external"}),
            source: Value::Null,
        };
        let v = serde_json::to_value(&b).unwrap();
        let b: Binding = serde_json::from_value(v).unwrap();
        assert!(check_binding(&b, "example", &b.marker, &b.marker, &b.snapshot).is_ok());
        assert!(check_binding(&b, "other", &b.marker, &b.marker, &b.snapshot).is_err());
        assert!(check_binding(&b, "example", &b.marker, "unowned", &b.snapshot).is_err());
        assert!(check_binding(
            &b,
            "example",
            &b.marker,
            &b.marker,
            &json!({"title":"local"})
        )
        .is_err());
    }
    #[test]
    fn metadata_changes_preserve_semantic_binding_and_legacy_owned_fields() {
        let mut source = item();
        source.url = "https://example.invalid/event".into();
        let marker = "[TouDi:example:synthetic]";
        let old = json!({"title":"示例","notes":format!("完整备注\n{marker}"),"location":"示例地点","start":1.,"end":2.,"allDay":false,"calendar":"example","modified":100.});
        let b = Binding {event_id:"synthetic".into(),calendar_id:"example".into(),marker:marker.into(),snapshot:old.clone(),source:serde_json::to_value(&source).unwrap()};
        let mut current = old;
        current["modified"] = json!(200.);
        current["url"] = json!(source.url);
        current["timeZone"] = json!(source.time_zone);
        current["alarms"] = json!([{"relative":-900.,"absolute":null}]);
        assert!(check_binding(&b,"example",marker,current["notes"].as_str().unwrap(),&current).is_ok());
        for field in ["title","notes","location","start","end","allDay","calendar","url","timeZone","alarms"] {
            let mut changed = current.clone();
            changed[field] = json!("external change");
            assert!(check_binding(&b,"example",marker,current["notes"].as_str().unwrap(),&changed).is_err(),"{field}");
        }
        let mut incomplete = b;
        incomplete.source = Value::Null;
        assert!(check_binding(&incomplete,"example",marker,current["notes"].as_str().unwrap(),&current).is_err());
    }
}

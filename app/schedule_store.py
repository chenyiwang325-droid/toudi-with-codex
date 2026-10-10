"""Strict, portable schedule data and iCalendar export; no OS calendar access."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import urlsplit
import hashlib
import re

PATH = '投递数据/日程数据.json'
TYPES = ('application', 'exam', 'interview', 'preparation', 'review', 'other')
STATUSES = ('planned', 'completed', 'cancelled')


def empty():
    return {'schemaVersion': 1, 'timeZone': 'Asia/Shanghai', 'events': [],
            'calendar': {'enabled': False, 'calendarId': ''}}


def zone(name):
    if not isinstance(name, str) or not name or len(name) > 100:
        raise ValueError('日程时区无效')
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError('日程时区无效') from None


def parse_day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('全天日期使用 YYYY-MM-DD')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError('日程日期不存在') from None


def parse_time(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError('日程时间无效')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('日程时间无效') from None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})', value) or result.tzinfo is None:
        raise ValueError('具体时间必须带时区偏移')
    return result


def validate(pack):
    if not isinstance(pack, dict) or type(pack.get('schemaVersion')) is not int or pack.get('schemaVersion') != 1:
        raise ValueError('不支持的日程格式')
    if set(pack) - {'schemaVersion', 'timeZone', 'events', 'calendar'}:
        raise ValueError('日程包含未定义的设置')
    zone(pack.get('timeZone'))
    rows = pack.get('events')
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ValueError('日程 events 必须为数组，最多 10000 项')
    ids = set()
    allowed = {'id', 'title', 'type', 'status', 'start', 'end', 'allDay', 'timeZone',
               'companyKey', 'prepId', 'reviewId', 'location', 'url', 'meetingInfo', 'notes',
               'priority', 'estimatedMinutes', 'reminderMinutes', 'syncToCalendar'}
    for event in rows:
        if not isinstance(event, dict) or set(event) - allowed:
            raise ValueError('日程事项包含未定义字段')
        ident = event.get('id')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', ident) or ident in ids:
            raise ValueError('日程 id 必须稳定、唯一且非空')
        ids.add(ident)
        if not isinstance(event.get('title'), str) or not event['title'].strip() or len(event['title']) > 512:
            raise ValueError('请输入事项标题（最多 512 字）')
        if event.get('type') not in TYPES or event.get('status') not in STATUSES:
            raise ValueError('日程类型或状态无效')
        if type(event.get('allDay')) is not bool or type(event.get('syncToCalendar', False)) is not bool:
            raise ValueError('全天和同步选项必须为布尔值')
        zone(event.get('timeZone', pack['timeZone']))
        start, end = event.get('start'), event.get('end')
        if start is None:
            if end is not None:
                raise ValueError('未排期事项不能单独设置结束时间')
        elif event['allDay']:
            first = parse_day(start)
            if end is not None and parse_day(end) <= first:
                raise ValueError('全天结束日期采用排他上界，必须晚于开始日期')
        else:
            first = parse_time(start)
            if end is not None and parse_time(end) <= first:
                raise ValueError('结束时间必须晚于开始时间')
        for key in ('companyKey', 'prepId', 'reviewId', 'location', 'url', 'meetingInfo', 'notes'):
            if key in event and (not isinstance(event[key], str) or len(event[key]) > (30000 if key == 'notes' else 2048)):
                raise ValueError('日程关联或说明格式无效')
        if event.get('url'):
            url = urlsplit(event['url'])
            if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or any(ord(c) < 32 for c in event['url']):
                raise ValueError('日程链接仅支持不含凭据的 HTTP(S)')
        for key, minimum, maximum in (('priority', 0, 2), ('estimatedMinutes', 1, 43200), ('reminderMinutes', 0, 43200)):
            value = event.get(key)
            if value is not None and (type(value) is not int or not minimum <= value <= maximum):
                raise ValueError('日程优先级、时长或提醒设置无效')
    config = pack.get('calendar', {'enabled': False, 'calendarId': ''})
    if not isinstance(config, dict) or set(config) - {'enabled', 'calendarId'} or type(config.get('enabled')) is not bool or not isinstance(config.get('calendarId'), str) or len(config['calendarId']) > 512:
        raise ValueError('本机日历连接设置无效')
    if config['enabled'] and not config['calendarId']:
        raise ValueError('请选择本机目标日历')
    return pack


def text(value):
    return str(value or '').replace('\\', '\\\\').replace('\r\n', '\n').replace('\r', '\n').replace('\n', '\\n').replace(';', '\\;').replace(',', '\\,')


def fold(line):
    """RFC 5545: at most 75 octets, never split a UTF-8 code point."""
    rows, part, length = [], '', 0
    for char in line:
        size = len(char.encode('utf-8'))
        if length + size > 75:
            rows.append(part)
            part, length = ' ', 1
        part += char
        length += size
    rows.append(part)
    return '\r\n'.join(rows)


def export_ics(pack, workspace_key, ids=None):
    validate(pack)
    chosen = None if ids is None else set(ids)
    if chosen is not None and (len(chosen) > 10000 or not chosen.issubset({row['id'] for row in pack['events']})):
        raise ValueError('导出事项不属于当前日程')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TouDi//Schedule//ZH', 'CALSCALE:GREGORIAN']
    for row in pack['events']:
        if not row.get('start') or row['status'] == 'cancelled' or (chosen is not None and row['id'] not in chosen):
            continue
        uid = hashlib.sha256((workspace_key + ':' + row['id']).encode()).hexdigest() + '@toudi.local'
        lines += ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp, 'SUMMARY:' + text(row['title'])]
        if row['allDay']:
            first = parse_day(row['start'])
            last = parse_day(row['end']) if row.get('end') else first + timedelta(days=1)
            lines += ['DTSTART;VALUE=DATE:' + first.strftime('%Y%m%d'), 'DTEND;VALUE=DATE:' + last.strftime('%Y%m%d')]
        else:
            lines.append('DTSTART:' + parse_time(row['start']).astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
            if row.get('end'):
                lines.append('DTEND:' + parse_time(row['end']).astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        if row.get('location'): lines.append('LOCATION:' + text(row['location']))
        description = row.get('notes', '')
        if row.get('meetingInfo'):
            description += ('\n\n' if description else '') + '入会信息：' + row['meetingInfo']
        if description: lines.append('DESCRIPTION:' + text(description))
        if row.get('url'): lines.append('URL:' + row['url'].replace('\r', '').replace('\n', ''))
        if row.get('reminderMinutes') is not None:
            lines += ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + text(row['title']),
                      'TRIGGER:-PT' + str(row['reminderMinutes']) + 'M', 'END:VALARM']
        lines.append('END:VEVENT')
    lines.append('END:VCALENDAR')
    return ('\r\n'.join(fold(line) for line in lines) + '\r\n').encode('utf-8')

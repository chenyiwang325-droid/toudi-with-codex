"""Usable public defaults, corrected by the user's source without changing records."""
from collections import Counter
import copy
import json
from pathlib import Path
import unicodedata

DIMENSIONS = {'natures': '性质', 'industries': '行业', 'education': '学历要求'}


def label(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', value)
                   if c not in '\u200b\u200c\u200d\ufeff').strip()


def group_values(groups):
    for group in groups:
        yield from group.get('values', [])
        yield from group_values(group.get('children', []))


def default_rules():
    return json.loads((Path(__file__).parent / 'assets/preference-defaults.json').read_text(encoding='utf-8'))


def effective_rules(rules=None):
    """Empty groups inherit defaults; nonempty groups explicitly replace a dimension's tree."""
    result = default_rules()
    if rules is None:
        return result
    validate_rules(rules)
    result['directionMatch'] = rules.get('directionMatch', result['directionMatch'])
    for name, patch in rules['dimensions'].items():
        target = result['dimensions'][name]
        for key in ('separator', 'ignored'):
            if key in patch:
                target[key] = copy.deepcopy(patch[key])
        for key in ('aliases', 'levels'):
            if key in patch:
                target[key] = {**target.get(key, {}), **patch[key]}
        if name != 'education' and patch.get('groups'):
            target['groups'] = copy.deepcopy(patch['groups'])
    validate_rules(result)
    return result


def bootstrap_script(rules=None):
    def safe(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    script = 'window.__TOUDI_PREFERENCE_DEFAULTS__=' + safe(default_rules()) + ';'
    if rules is not None:
        script += 'window.__TOUDI_SNAPSHOT_PREFERENCE_RULES__=' + safe(rules) + ';'
    return script


def validate_rules(rules):
    if not isinstance(rules, dict) or rules.get('schemaVersion') != 1:
        raise ValueError('preferenceRules.schemaVersion must be 1')
    if rules.get('directionMatch', 'any') not in ('any', 'all'):
        raise ValueError('preferenceRules.directionMatch must be any or all')
    dimensions = rules.get('dimensions')
    if not isinstance(dimensions, dict) or set(dimensions) != set(DIMENSIONS):
        raise ValueError('preferenceRules needs natures, industries and education')
    for name, dimension in dimensions.items():
        if not isinstance(dimension, dict):
            raise ValueError(name + ' must be an object')
        separator = dimension.get('separator', '')
        if not isinstance(separator, str) or len(separator) > 4:
            raise ValueError(name + '.separator must be a short literal string')
        if name == 'education' and separator:
            raise ValueError('education requirements must be mapped as complete phrases, not split')
        aliases = dimension.get('aliases', {})
        if not isinstance(aliases, dict) or any(not isinstance(k, str) or not label(k)
                or not isinstance(v, str) or not label(v) for k, v in aliases.items()):
            raise ValueError(name + '.aliases must map nonempty source labels to labels')
        normalized = {label(k): label(v) for k, v in aliases.items()}
        if len(normalized) != len(aliases):
            raise ValueError(name + '.aliases contain duplicate normalized labels')
        if any(v in normalized and normalized[v] != v for v in normalized.values()):
            raise ValueError(name + '.aliases must point directly to final labels')
        groups = dimension.get('groups', [])
        if not isinstance(groups, list):
            raise ValueError(name + '.groups must be an array')
        seen, names = set(), set()
        def visit(group, depth=0):
            if depth > 2:
                raise ValueError(name + ': group nesting must not exceed three levels')
            if not isinstance(group, dict) or not isinstance(group.get('name'), str) or not label(group['name']):
                raise ValueError(name + ': nonempty group name required')
            group_name = label(group['name'])
            if group_name in names:
                raise ValueError(name + ': duplicate group name')
            names.add(group_name)
            values = group.get('values', [])
            if not isinstance(values, list) or any(not isinstance(v, str) or not label(v) for v in values):
                raise ValueError(name + ': group values must be nonempty labels')
            canonical = [normalized.get(label(v), label(v)) for v in values]
            if len(set(canonical)) != len(canonical) or seen.intersection(canonical):
                raise ValueError(name + ': a label may belong to only one group')
            seen.update(canonical)
            children = group.get('children', [])
            if not isinstance(children, list) or not (values or children):
                raise ValueError(name + ': group needs values or children')
            for child in children:
                visit(child, depth + 1)
        for group in groups:
            visit(group)
        ignored = dimension.get('ignored', [])
        if not isinstance(ignored, list) or any(not isinstance(v, str) or not label(v) for v in ignored):
            raise ValueError(name + '.ignored must be an array of nonempty labels')
        if {normalized.get(label(v), label(v)) for v in ignored}.intersection(seen):
            raise ValueError(name + ': ignored labels cannot be selectable')
        levels = dimension.get('levels', {})
        if not isinstance(levels, dict) or any(not isinstance(k, str) or not label(k)
                or not isinstance(v, list) or any(not isinstance(x, str) or not label(x) for x in v)
                or len(set(v)) != len(v) for k, v in levels.items()):
            raise ValueError(name + '.levels must map complete requirements to degree arrays')
        if name != 'education' and levels:
            raise ValueError('levels are only supported for education')
        allowed_levels = {'高中', '中专', '大专', '本科', '硕士', '博士'}
        if any(level not in allowed_levels for values in levels.values() for level in values):
            raise ValueError('education.levels must use selectable degrees')


def catalog(records, settings):
    """Expose defaults and remaining source corrections; never mutate workspace preferences."""
    rules = settings.get('preferenceRules')
    if rules is not None:
        validate_rules(rules)
    effective = effective_rules(rules)
    result = {}
    for name, field in DIMENSIONS.items():
        counts = Counter(str(record.get(field) or '') for record in records)
        dimension = effective['dimensions'][name]
        aliases = {label(k): label(v) for k, v in dimension.get('aliases', {}).items()}
        known = {aliases.get(label(v), label(v)) for v in group_values(dimension.get('groups', []))}
        known.update(dimension.get('levels', {}))
        ignored = {aliases.get(label(v), label(v)) for v in dimension.get('ignored', [])}
        separator = dimension.get('separator', '')
        result[name] = {'field': field, 'values': [
            {'raw': raw, 'count': count, 'unmapped': [part for part in
                (raw.split(separator) if separator else [raw])
                if label(part) and aliases.get(label(part), label(part)) not in known | ignored]}
            for raw, count in sorted(counts.items())]}
    return {'initialized': rules is not None, 'defaultsAvailable': True,
            'effectiveRules': effective, 'dimensions': result}

"""Source-specific preference vocabulary, supplied by the user's Agent."""
from collections import Counter
import unicodedata

DIMENSIONS = {'natures': '性质', 'industries': '行业', 'education': '学历要求'}


def label(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', value)
                   if c not in '\u200b\u200c\u200d\ufeff').strip()


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
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get('name'), str) or not label(group['name']):
                raise ValueError(name + ': nonempty group name required')
            group_name = label(group['name'])
            if group_name in names:
                raise ValueError(name + ': duplicate group name')
            names.add(group_name)
            values = group.get('values')
            if not isinstance(values, list) or any(not isinstance(v, str) or not label(v) for v in values):
                raise ValueError(name + ': group values must be nonempty labels')
            canonical = [normalized.get(label(v), label(v)) for v in values]
            if len(set(canonical)) != len(canonical) or seen.intersection(canonical):
                raise ValueError(name + ': a label may belong to only one group')
            seen.update(canonical)


def catalog(records, settings):
    """Read raw source vocabulary without guessing aliases or qualifications."""
    rules = settings.get('preferenceRules')
    if rules is not None:
        validate_rules(rules)
    result = {}
    for name, field in DIMENSIONS.items():
        counts = Counter(str(record.get(field) or '') for record in records)
        dimension = rules['dimensions'][name] if rules else {}
        aliases = {label(k): label(v) for k, v in dimension.get('aliases', {}).items()}
        known = set(aliases.values()) | {aliases.get(label(v), label(v))
                for group in dimension.get('groups', []) for v in group['values']}
        separator = dimension.get('separator', '')
        result[name] = {'field': field, 'values': [
            {'raw': raw, 'count': count, 'unmapped': [part for part in
                (raw.split(separator) if separator else [raw])
                if not label(part) or aliases.get(label(part), label(part)) not in known]}
            for raw, count in sorted(counts.items())]}
    return {'initialized': rules is not None, 'dimensions': result}

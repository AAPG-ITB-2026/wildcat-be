export function resolveObjectKeyFromReference(
    fileReference: string | null | undefined,
): string | null {
    if (!fileReference) {
        return null;
    }

    const trimmed = fileReference.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const parsed = new URL(trimmed);
            const keyFromPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
            return sanitizeObjectKey(keyFromPath);
        } catch {
            return null;
        }
    }

    return sanitizeObjectKey(trimmed);
}

function sanitizeObjectKey(input: string): string | null {
    const withoutQuery = input.split('?')[0]?.split('#')[0] ?? '';
    const normalized = withoutQuery.replace(/^\/+/, '').trim();

    if (!normalized) {
        return null;
    }

    if (
        normalized.includes('..')
        || normalized.includes('\\')
        || normalized.includes('//')
    ) {
        return null;
    }

    return normalized;
}

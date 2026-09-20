const hotwaxOmsSuffix = '.hotwax.io';
const instanceNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function buildOmsOrigin(instanceName: string): string {
  const value = instanceName.trim().toLowerCase();
  if (!instanceNamePattern.test(value)) throw new Error('Enter a HotWax instance name such as test-maarg.');
  return `https://${value}${hotwaxOmsSuffix}`;
}

export function instanceNameFromOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || !url.hostname.endsWith(hotwaxOmsSuffix)) return '';
    const value = url.hostname.slice(0, -hotwaxOmsSuffix.length);
    return instanceNamePattern.test(value) ? value : '';
  } catch {
    return '';
  }
}

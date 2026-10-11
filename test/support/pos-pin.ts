/** Map an ordered native tap sequence from the currently visible POS keypad. */
export function pinPadTapCoordinates(snapshot: string, value: string | number) {
  const pin = String(value);
  if (!/^\d{4,6}$/.test(pin)) throw new Error('A POS PIN must contain four to six digits.');
  const positions = new Map<string, {x: number; y: number}>();
  for (const tag of snapshot.match(/<XCUIElementTypeButton\b[^>]*>/g) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    const digit = /^Component\.PINPad\.KeyPad\.DigitButton\.(\d)$/.exec(attributes.name || '')?.[1];
    if (!digit || attributes.visible !== 'true' || attributes.enabled === 'false') continue;
    const x = Number(attributes.x), y = Number(attributes.y), width = Number(attributes.width), height = Number(attributes.height);
    if (![x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0 || positions.has(digit)) throw new Error('Inspect the visible POS keypad geometry.');
    positions.set(digit, {x: Math.round(x+width/2), y: Math.round(y+height/2)});
  }
  if (positions.size !== 10) throw new Error('The complete visible POS keypad is required for fast entry.');
  return [...pin].map(digit => positions.get(digit)!);
}

// The times after which an image can expire, in seconds, 0 for never
export const ExpiryOptions: { name: string; seconds: number }[] = [
  { name: 'Never', seconds: 0 },
  { name: '5 Minutes', seconds: 5 * 60 },
  { name: '10 Minutes', seconds: 10 * 60 },
  { name: '30 Minutes', seconds: 30 * 60 },
  { name: '1 Hour', seconds: 60 * 60 },
  { name: '6 Hours', seconds: 6 * 60 * 60 },
  { name: '12 Hours', seconds: 12 * 60 * 60 },
  { name: '1 Day', seconds: 24 * 60 * 60 },
  { name: '1 Week', seconds: 7 * 24 * 60 * 60 },
  { name: '1 Month', seconds: 30 * 24 * 60 * 60 },
];

const Units: [string, number][] = [
  ['Day', 24 * 60 * 60],
  ['Hour', 60 * 60],
  ['Minute', 60],
  ['Second', 1],
];

// Like "2 Hours", also for a time that is none of the options
export function ExpiryName(seconds: number): string {
  const option = ExpiryOptions.find((option) => option.seconds === seconds);
  if (option !== undefined) return option.name;
  const [unit, size] = Units.find(([, size]) => seconds % size === 0)!;
  const count = seconds / size;
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

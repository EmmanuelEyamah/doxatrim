export interface AudioLayer {
  id: string;
  file: File; // audio OR video source — only its audio stream is used
  name: string;
  sourceDuration: number; // seconds
  inPoint: number; // trim within source, seconds
  outPoint: number;
  startAt: number; // seconds on the project timeline
  loop: boolean; // repeat [inPoint, outPoint] until endAt
  endAt: number | null; // timeline seconds; null = natural end (loop: timeline end)
  volume: number; // 0..1
  muted: boolean;
  colorIndex: number; // lane color, maps to --chart-1..5
}

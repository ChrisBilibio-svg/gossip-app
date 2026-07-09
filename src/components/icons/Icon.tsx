import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Custom brand/UI icon set (from design/VIDDI_ICON_SYSTEM.html), rendered as real
 * vectors via react-native-svg — replaces the system emoji used across the app.
 * Monoline glyphs in a 48×48 viewBox, colorable, so they inherit the semantic
 * role color. Stroke scales with size so they stay crisp from 14px → 40px.
 *
 * Requires react-native-svg (native module) → a dev-build rebuild.
 */
export type IconName =
  | 'verdade'
  | 'mentira'
  | 'like'
  | 'dislike'
  | 'fire'
  | 'eyes'
  | 'target'
  | 'trophy'
  | 'chat'
  | 'groups'
  | 'check'
  | 'cross';

interface Props {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 16, color, strokeWidth }: Props) {
  const sw = strokeWidth ?? Math.min(5, Math.max(2, 100 / size));
  const S: StrokeProps = { fill: 'none', stroke: color, strokeWidth: sw, strokeLinejoin: 'round', strokeLinecap: 'round' };
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden>
      {glyph(name, color, sw, S)}
    </Svg>
  );
}

type StrokeProps = { fill: 'none'; stroke: string; strokeWidth: number; strokeLinejoin: 'round'; strokeLinecap: 'round' };

function glyph(name: IconName, c: string, sw: number, S: StrokeProps) {
  switch (name) {
    case 'verdade':
      return (<>
        <Path d="M15 22 H31 V27 A5 5 0 0 1 26 32 H20 A5 5 0 0 1 15 27 Z" {...S} />
        <Path d="M31 23.5 H33.5 A3.3 3.3 0 0 1 33.5 30.1 H31.5" {...S} />
        <Path d="M14 34.5 H32" {...S} />
        <Path d="M20 19 q2.4 -2 0 -4.4" {...S} opacity={0.75} />
        <Path d="M24 19 q2.4 -2 0 -4.4" {...S} opacity={0.75} />
        <Path d="M28 19 q2.4 -2 0 -4.4" {...S} opacity={0.75} />
      </>);
    case 'mentira':
      return (<>
        <Path d="M14 27.5 Q14 16 24 16 Q34 16 34 27.5" {...S} />
        <Path d="M13 28 H35" {...S} />
        <Path d="M34 28 Q40.5 28 41 31.2" {...S} />
        <Circle cx={24} cy={16} r={1.4} fill={c} />
      </>);
    case 'like':
      return (<>
        <Path d="M15 23 H18 V33 H15 Z" {...S} />
        <Path d="M18 23 L23 14.5 Q24.2 12.5 25.8 14 Q26.8 15 26.4 16.8 L25.4 21.5 H32 Q34 21.5 33.6 23.5 L31.9 31 Q31.5 33 29.5 33 H18 Z" {...S} />
      </>);
    case 'dislike':
      return (<>
        <Path d="M33 25 H30 V15 H33 Z" {...S} />
        <Path d="M30 25 L25 33.5 Q23.8 35.5 22.2 34 Q21.2 33 21.6 31.2 L22.6 26.5 H16 Q14 26.5 14.4 24.5 L16.1 17 Q16.5 15 18.5 15 H30 Z" {...S} />
      </>);
    case 'fire':
      return <Path d="M24 13 C30 18 27.5 24 27.5 24 C31 23 31 19.5 31 19.5 C34 24 31 31 24 32 C17 31 15 25 18 20 C18 23 20 24 20 24 C19 19 24 16 24 13 Z" {...S} />;
    case 'eyes':
      return (<>
        <Path d="M11 24 Q18 18 25 24 Q18 30 11 24 Z" {...S} />
        <Path d="M23 24 Q30 18 37 24 Q30 30 23 24 Z" {...S} />
        <Circle cx={18} cy={24} r={2} fill={c} />
        <Circle cx={30} cy={24} r={2} fill={c} />
      </>);
    case 'target':
      return (<>
        <Circle cx={24} cy={24} r={11} {...S} />
        <Circle cx={24} cy={24} r={6} {...S} />
        <Circle cx={24} cy={24} r={1.8} fill={c} />
      </>);
    case 'trophy':
      return (<>
        <Path d="M16 13 H32 V18 Q32 25 24 25 Q16 25 16 18 Z" {...S} />
        <Path d="M16 15 Q11 15 11 19 Q11 22.5 15 22.5" {...S} />
        <Path d="M32 15 Q37 15 37 19 Q37 22.5 33 22.5" {...S} />
        <Path d="M24 25 V30" {...S} />
        <Path d="M18 34 H30 L28.5 30 H19.5 Z" {...S} />
      </>);
    case 'chat':
      return <Path d="M12 15 H36 A3 3 0 0 1 39 18 V28 A3 3 0 0 1 36 31 H22 L15 36 V31 H12 A3 3 0 0 1 9 28 V18 A3 3 0 0 1 12 15 Z" {...S} />;
    case 'groups':
      return (<>
        <Circle cx={18} cy={19} r={5} {...S} />
        <Path d="M9 34 Q9 25.5 18 25.5 Q22 25.5 24.5 27.5" {...S} />
        <Circle cx={31} cy={21} r={4.3} {...S} />
        <Path d="M27 30 Q31 27.5 35 29 Q39 31 39 36" {...S} />
      </>);
    case 'check':
      return <Path d="M13 25 l7 7 15 -16" {...S} strokeWidth={sw + 0.6} />;
    case 'cross':
      return <Path d="M15 15 L33 33 M33 15 L15 33" {...S} strokeWidth={sw + 0.6} />;
    default:
      return null;
  }
}

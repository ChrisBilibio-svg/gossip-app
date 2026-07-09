import { Text } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

/**
 * Renders the 12 persona avatars from design/VIDDI_ICON_SYSTEM.html as real
 * monoline vectors. Avatar values are still stored as emoji in the DB
 * (profiles.avatar); this maps the emoji → its custom glyph at render time, so
 * it's fully backward-compatible and any unknown value falls back to the emoji.
 */
const EMOJI_TO_ID: Record<string, string> = {
  '🔮': 'ball', '🍵': 'tea', '🧢': 'cap', '👀': 'eyes', '🔥': 'fire', '👑': 'crown',
  '⭐': 'star', '🎭': 'mask', '✨': 'spark', '👻': 'ghost', '🛸': 'ufo', '🃏': 'joker',
};

const CLR: Record<string, string> = {
  ball: '#A78BFA', tea: '#2DD4BF', cap: '#FB7185', eyes: '#FF6FB0', fire: '#F5A623',
  crown: '#F0C24C', star: '#F0C24C', mask: '#A78BFA', spark: '#FF6FB0', ghost: '#C9C5D6',
  ufo: '#7DD3FC', joker: '#FB7185',
};

function glyph(id: string, c: string, sw: number) {
  const S = { fill: 'none', stroke: c, strokeWidth: sw, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (id) {
    case 'ball':
      return (<>
        <Circle cx={24} cy={21.5} r={8} {...S} />
        <Path d="M17.5 31 H30.5 L28.7 27.8 H19.3 Z" {...S} />
        <Path d="M24 18 l0.9 2.5 2.5 0.9 -2.5 0.9 -0.9 2.5 -0.9 -2.5 -2.5 -0.9 2.5 -0.9 Z" fill={c} />
      </>);
    case 'tea':
      return (<>
        <Path d="M15 22 H31 V27 A5 5 0 0 1 26 32 H20 A5 5 0 0 1 15 27 Z" {...S} />
        <Path d="M31 23.5 H33.5 A3.3 3.3 0 0 1 33.5 30.1 H31.5" {...S} />
        <Path d="M14 34.5 H32" {...S} />
        <Path d="M20 19 q2.4 -2 0 -4.4" {...S} opacity={0.75} />
        <Path d="M28 19 q2.4 -2 0 -4.4" {...S} opacity={0.75} />
      </>);
    case 'cap':
      return (<>
        <Path d="M14 27.5 Q14 16 24 16 Q34 16 34 27.5" {...S} />
        <Path d="M13 28 H35" {...S} />
        <Path d="M34 28 Q40.5 28 41 31.2" {...S} />
        <Circle cx={24} cy={16} r={1.4} fill={c} />
      </>);
    case 'eyes':
      return (<>
        <Ellipse cx={18.5} cy={24} rx={4} ry={4.8} {...S} />
        <Ellipse cx={29.5} cy={24} rx={4} ry={4.8} {...S} />
        <Circle cx={19.2} cy={25} r={1.6} fill={c} />
        <Circle cx={30.2} cy={25} r={1.6} fill={c} />
      </>);
    case 'fire':
      return <Path d="M24 13 C30 18 27.5 24 27.5 24 C31 23 31 19.5 31 19.5 C34 24 31 31 24 32 C17 31 15 25 18 20 C18 23 20 24 20 24 C19 19 24 16 24 13 Z" {...S} />;
    case 'crown':
      return (<>
        <Path d="M13 31 L11 18 L18.5 23 L24 15 L29.5 23 L37 18 L35 31 Z" {...S} />
        <Path d="M13.5 31.5 H34.5" {...S} />
      </>);
    case 'star':
      return <Path d="M24 14 l2.6 6.8 7.3 0.4 -5.7 4.6 2 7 -6.2 -4 -6.2 4 2 -7 -5.7 -4.6 7.3 -0.4 Z" {...S} />;
    case 'mask':
      return (<>
        <Path d="M15 17 H33 V22 Q33 33 24 33 Q15 33 15 22 Z" {...S} />
        <Circle cx={20} cy={23} r={1.5} fill={c} />
        <Circle cx={28} cy={23} r={1.5} fill={c} />
        <Path d="M20.5 28 Q24 30.5 27.5 28" {...S} />
      </>);
    case 'spark':
      return (<>
        <Path d="M20 14 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 Z" {...S} />
        <Path d="M30 24 l1 2.7 2.7 1 -2.7 1 -1 2.7 -1 -2.7 -2.7 -1 2.7 -1 Z" fill={c} />
      </>);
    case 'ghost':
      return (<>
        <Path d="M15 24 a9 9 0 0 1 18 0 V32 l-3 -2 -3 2 -3 -2 -3 2 -3 -2 Z" {...S} />
        <Circle cx={20.5} cy={23.5} r={1.5} fill={c} />
        <Circle cx={27.5} cy={23.5} r={1.5} fill={c} />
      </>);
    case 'ufo':
      return (<>
        <Ellipse cx={24} cy={26} rx={11} ry={3.6} {...S} />
        <Path d="M18 24.5 Q24 17 30 24.5" {...S} />
        <Path d="M20 30 L18.5 33 M28 30 L29.5 33 M24 30.5 V34" {...S} />
      </>);
    case 'joker':
      return (<>
        <Rect x={17} y={14} width={14} height={20} rx={2.5} {...S} />
        <Path d="M24 19 l1.2 3.2 3.4 0.2 -2.7 2.1 1 3.3 -2.9 -1.9 -2.9 1.9 1 -3.3 -2.7 -2.1 3.4 -0.2 Z" fill={c} />
      </>);
    default:
      return null;
  }
}

export default function Avatar({ value, size = 24 }: { value?: string | null; size?: number }) {
  const id = value ? EMOJI_TO_ID[value] : undefined;
  if (!id) {
    // Unknown / legacy value → render the raw emoji so nothing ever breaks.
    return <Text style={{ fontSize: Math.round(size * 0.82) }}>{value ?? '🔮'}</Text>;
  }
  const sw = Math.min(5, Math.max(2, 100 / size));
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden>
      {glyph(id, CLR[id], sw)}
    </Svg>
  );
}

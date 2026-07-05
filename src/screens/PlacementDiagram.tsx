import type { Diagram } from '../exercises';

/** Brutalist line diagrams for phone placement — one glance says where the
 *  phone goes and where you go. Bone lines, acid-green phone + view cone. */

const BONE = 'rgba(237,237,234,0.55)';
const DIM = 'rgba(237,237,234,0.25)';
const EARN = '#9be564';

export function PlacementDiagram({ kind }: { kind: Diagram }) {
  return (
    <div className="border border-bone/15 p-3">
      <svg
        viewBox="0 0 200 84"
        className="h-auto w-full"
        fill="none"
        stroke={BONE}
        strokeWidth="2"
        strokeLinecap="square"
      >
        {kind === 'side' && <SideOn />}
        {kind === 'sideStand' && <SideStand />}
        {kind === 'front' && <FrontOn />}
        {kind === 'near' && <NearUpper />}
        {kind === 'face' && <NearFace />}
      </svg>
    </div>
  );
}

/** phone SIDEWAYS (landscape) on the floor, side-on view of a horizontal body */
function SideOn() {
  return (
    <>
      {/* ground */}
      <line x1="8" y1="72" x2="192" y2="72" stroke={DIM} />
      {/* phone lying landscape, propped on the floor — wider than tall */}
      <rect x="10" y="58" width="26" height="14" stroke={EARN} />
      <line x1="14" y1="62" x2="14" y2="68" stroke={EARN} strokeDasharray="1 2" />
      {/* view cone */}
      <line x1="36" y1="58" x2="92" y2="34" stroke={EARN} strokeDasharray="4 4" />
      <line x1="36" y1="70" x2="92" y2="70" stroke={EARN} strokeDasharray="4 4" />
      {/* horizontal body: head, straight line shoulder->ankle, arms down */}
      <circle cx="102" cy="52" r="6" />
      <line x1="108" y1="56" x2="178" y2="64" />
      <line x1="116" y1="57" x2="116" y2="72" />
      <line x1="170" y1="63" x2="178" y2="72" />
      {/* notes */}
      <text x="52" y="14" fill={DIM} stroke="none" fontSize="9" fontFamily="monospace">
        2–3 M
      </text>
      <line x1="26" y1="18" x2="94" y2="18" stroke={DIM} strokeDasharray="2 3" />
      <text x="8" y="50" fill={DIM} stroke="none" fontSize="8" fontFamily="monospace">
        LANDSCAPE
      </text>
    </>
  );
}

/** phone SIDEWAYS (landscape) propped up, standing body side-on 2–3m away */
function SideStand() {
  return (
    <>
      {/* ground */}
      <line x1="8" y1="72" x2="192" y2="72" stroke={DIM} />
      {/* phone landscape, propped up */}
      <rect x="10" y="58" width="26" height="14" stroke={EARN} />
      <line x1="14" y1="62" x2="14" y2="68" stroke={EARN} strokeDasharray="1 2" />
      {/* view cone up to full standing height */}
      <line x1="36" y1="58" x2="126" y2="10" stroke={EARN} strokeDasharray="4 4" />
      <line x1="36" y1="70" x2="126" y2="70" stroke={EARN} strokeDasharray="4 4" />
      {/* standing figure, side-on: head, torso, one arm forward, bent knees hint */}
      <circle cx="146" cy="18" r="7" />
      <line x1="146" y1="25" x2="146" y2="46" />
      <line x1="146" y1="32" x2="160" y2="36" />
      <line x1="146" y1="46" x2="152" y2="58" />
      <line x1="152" y1="58" x2="148" y2="72" />
      {/* notes */}
      <text x="56" y="14" fill={DIM} stroke="none" fontSize="9" fontFamily="monospace">
        2–3 M
      </text>
      <text x="8" y="50" fill={DIM} stroke="none" fontSize="8" fontFamily="monospace">
        LANDSCAPE
      </text>
    </>
  );
}

/** phone propped up front-on, whole standing body in frame */
function FrontOn() {
  return (
    <>
      <line x1="8" y1="72" x2="192" y2="72" stroke={DIM} />
      <rect x="14" y="46" width="10" height="26" stroke={EARN} />
      <line x1="24" y1="48" x2="120" y2="12" stroke={EARN} strokeDasharray="4 4" />
      <line x1="24" y1="70" x2="120" y2="70" stroke={EARN} strokeDasharray="4 4" />
      {/* standing figure, front-on: head, torso, arms out, legs */}
      <circle cx="146" cy="20" r="7" />
      <line x1="146" y1="27" x2="146" y2="50" />
      <line x1="132" y1="38" x2="160" y2="38" />
      <line x1="146" y1="50" x2="136" y2="72" />
      <line x1="146" y1="50" x2="156" y2="72" />
      <text x="56" y="66" fill={DIM} stroke="none" fontSize="9" fontFamily="monospace">
        2–3 M
      </text>
    </>
  );
}

/** seated, head and shoulders in frame, phone at arm's length */
function NearUpper() {
  return (
    <>
      <line x1="8" y1="72" x2="192" y2="72" stroke={DIM} />
      {/* phone on a stand at arm's length */}
      <rect x="44" y="34" width="12" height="24" stroke={EARN} />
      <line x1="50" y1="58" x2="50" y2="72" stroke={EARN} />
      <line x1="56" y1="38" x2="120" y2="24" stroke={EARN} strokeDasharray="4 4" />
      <line x1="56" y1="52" x2="120" y2="58" stroke={EARN} strokeDasharray="4 4" />
      {/* seated figure: head, shoulders, folded posture */}
      <circle cx="140" cy="26" r="8" />
      <line x1="140" y1="34" x2="140" y2="54" />
      <line x1="126" y1="44" x2="154" y2="44" />
      <line x1="140" y1="54" x2="156" y2="60" />
      <line x1="156" y1="60" x2="156" y2="72" />
      <text x="76" y="14" fill={DIM} stroke="none" fontSize="9" fontFamily="monospace">
        ARM'S LENGTH
      </text>
    </>
  );
}

/** face filling the frame, phone held close */
function NearFace() {
  return (
    <>
      {/* phone, big in the foreground */}
      <rect x="30" y="12" width="34" height="60" stroke={EARN} />
      <line x1="64" y1="22" x2="118" y2="26" stroke={EARN} strokeDasharray="4 4" />
      <line x1="64" y1="62" x2="118" y2="58" stroke={EARN} strokeDasharray="4 4" />
      {/* big head: face filling the view */}
      <circle cx="146" cy="42" r="24" />
      {/* eyes — open */}
      <line x1="136" y1="36" x2="142" y2="36" />
      <line x1="150" y1="36" x2="156" y2="36" />
      {/* mouth flat */}
      <line x1="140" y1="52" x2="152" y2="52" />
      <text x="70" y="80" fill={DIM} stroke="none" fontSize="9" fontFamily="monospace">
        FACE FILLS THE FRAME
      </text>
    </>
  );
}

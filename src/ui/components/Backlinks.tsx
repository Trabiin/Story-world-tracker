/** EU-6: everything that mentions this record. */
import { LinkTargetKind, backlinksFor } from '../../core';
import { useApp } from '../context';

export function Backlinks({ kind, id, title = 'Mentioned in', only }: { kind: LinkTargetKind; id: string; title?: string; only?: string[] }) {
  const { world, go, edit, openPassage } = useApp();
  const list = backlinksFor(world, kind, id).filter((b) => !only || only.includes(b.kind));
  if (list.length === 0) return null;
  const open = (b: (typeof list)[number]) => {
    if (b.kind === 'passage') openPassage(b.manuscriptId!, b.linkId!);
    else if (b.kind === 'scene' || b.kind === 'chapter') go('story', b.id);
    else if (b.kind === 'stay' || b.kind === 'journey') edit({ kind: b.kind, id: b.id });
    else if (b.kind === 'place') go('places', b.id);
    else if (b.kind === 'membership') {
      const m = world.memberships.find((x) => x.id === b.id);
      if (m) go(kind === 'group' ? 'characters' : 'groups', kind === 'group' ? m.characterId : m.groupId);
    }
  };
  const order = ['passage', 'scene', 'chapter', 'stay', 'journey', 'membership', 'place'];
  const sorted = [...list].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return (
    <section className="backlinks">
      <h2>{title} <span className="muted">({list.length})</span></h2>
      <ul className="plain">
        {sorted.map((b) => (
          <li key={b.kind + b.id}>
            <button className="link" onClick={() => open(b)}>
              <span className={`kind kind-${b.kind}`}>{b.kind === 'passage' ? 'manuscript' : b.kind}</span> {b.label}
            </button>
            {b.detail && <span className="muted"> · {b.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { avatarIds, avatarInfo, chessPieceIds, chessPieceInfo, type AvatarId, type ChessPieceId } from '../../shared/game';

export function Avatar({ id, small = false }: { id: AvatarId; small?: boolean }) {
  const info = avatarInfo[id];
  return <span className={`avatar ${small ? 'avatar-small' : ''}`} style={{ background: info.tint }} role="img" aria-label={info.label}>{info.face}</span>;
}
export function AvatarPicker({ value, onChange }: { value: AvatarId; onChange: (id: AvatarId) => void }) {
  return <fieldset className="avatar-field"><legend>Pick your little companion</legend>
    <div className="avatar-picker">{avatarIds.map(id =>
      <button key={id} type="button" className={value === id ? 'selected' : ''} aria-label={`${avatarInfo[id].label} avatar`} aria-pressed={value === id} onClick={() => onChange(id)}>
        <Avatar id={id} />
      </button>)}</div>
  </fieldset>;
}
export function ChessPiecePicker({ value, onChange }: { value: ChessPieceId; onChange: (id: ChessPieceId) => void }) {
  return <fieldset className="piece-field"><legend>Pick your board piece</legend>
    <div className="piece-picker">{chessPieceIds.map(id =>
      <button key={id} type="button" className={value === id ? 'selected' : ''} aria-label={`${chessPieceInfo[id].label} piece`} aria-pressed={value === id} onClick={() => onChange(id)}>
        <span className="piece-glyph" aria-hidden="true">{chessPieceInfo[id].glyph}</span>
        <span className="piece-name">{chessPieceInfo[id].label}</span>
      </button>)}</div>
  </fieldset>;
}

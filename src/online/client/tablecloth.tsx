'use client';

import {useEffect, useRef, useState} from 'react';
import {Palette, X} from 'lucide-react';

export const tableclothPreference = 'yougui.mahjong.tablecloth';
export const tablecloths = [
  {id: 'midnight', name: '海夜', description: '靛蓝绒布'},
  {id: 'plum', name: '暮紫', description: '烟紫绒布'},
  {id: 'graphite', name: '石墨', description: '炭灰绒布'},
] as const;
export type Tablecloth = typeof tablecloths[number]['id'];
const valid = (value: unknown): value is Tablecloth => tablecloths.some(item => item.id === value);

export function useTablecloth() {
  const [cloth, setCloth] = useState<Tablecloth>('midnight');
  useEffect(() => {
    try { const saved = localStorage.getItem(tableclothPreference); if (valid(saved)) setCloth(saved); } catch { /* Session choice remains available. */ }
  }, []);
  return {cloth, choose: (value: Tablecloth) => {
    if (!valid(value)) return;
    setCloth(value);
    try { localStorage.setItem(tableclothPreference, value); } catch { /* Session choice remains available. */ }
  }};
}

export function TableclothPicker({cloth, onChoose, onOpen}: {cloth: Tablecloth; onChoose: (cloth: Tablecloth) => void; onOpen: () => void}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  useEffect(() => {if (!open && restoreFocus.current) {trigger.current?.focus(); restoreFocus.current = false;}}, [open]);
  return <>
    <button ref={trigger} type="button" className="mahjong-screen-button" aria-label="更换桌布" aria-haspopup="dialog" onClick={() => {onOpen(); setOpen(true);}}><Palette size={18}/></button>
    {open ? <TableclothDialog cloth={cloth} onChoose={onChoose} onClose={() => {restoreFocus.current = true; setOpen(false);}}/> : null}
  </>;
}

function TableclothDialog({cloth, onChoose, onClose}: {cloth: Tablecloth; onChoose: (cloth: Tablecloth) => void; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => {if (node?.open) node.close();};
  }, []);
  return <dialog ref={dialog} className="mahjong-confirm mahjong-tablecloth-picker" aria-labelledby="mahjong-tablecloth-title" onCancel={event => {event.preventDefault(); onClose();}}>
    <header><div><p className="mahjong-kicker">TABLE ATELIER</p><h2 id="mahjong-tablecloth-title">桌布</h2></div><button type="button" className="mahjong-icon-button" aria-label="关闭桌布选择" onClick={onClose}><X size={18}/></button></header>
    <div className="mahjong-tablecloth-options" role="group" aria-label="桌布样式">{tablecloths.map(item => <button key={item.id} type="button" data-tablecloth={item.id} aria-pressed={cloth === item.id} onClick={() => onChoose(item.id)}><span className="mahjong-tablecloth-swatch" aria-hidden="true"/><strong>{item.name}</strong><small>{item.description}</small><span className="mahjong-tablecloth-selected" aria-hidden="true">{cloth === item.id ? '已选' : '选择'}</span></button>)}</div>
    <footer><button type="button" className="mahjong-button mahjong-button--primary" onClick={onClose}>完成</button></footer>
  </dialog>;
}

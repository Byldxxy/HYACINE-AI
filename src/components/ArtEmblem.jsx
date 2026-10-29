import React from 'react';
import atlas from '../assets/atelier/emblems.png';

const CELLS = { overview: [0, 0], test: [50, 0], memory: [100, 0], persona: [0, 100], ai: [50, 100], connect: [100, 100] };
/** One generated atlas, shared by navigation, branding and status indicators. */
export default function ArtEmblem({ name = 'overview', className = '' }) {
    const [x, y] = CELLS[name] || CELLS.overview;
    return <span aria-hidden="true" className={`art-emblem ${className}`} style={{ backgroundImage: `url(${atlas})`, backgroundPosition: `${x}% ${y}%` }} />;
}

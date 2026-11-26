import React from 'react';
import { Button } from './UIComponents';

export default function EditConflict({ label, serverValue, localValue, onResolve, canKeep = true }) {
    return <div className="workspace-error flex-wrap" role="alert">
        <div className="min-w-0 flex-1"><strong>{label}已在其他位置更改</strong>
            <details><summary>查看差异</summary><div className="whitespace-pre-wrap break-words text-xs">
                <p>服务器 · {serverValue}</p><p>草稿 · {localValue}</p>
            </div></details>
        </div>
        {canKeep && <Button size="sm" onClick={() => onResolve(false)}>保留草稿</Button>}
        <Button size="sm" onClick={() => onResolve(true)}>采用服务器版本</Button>
    </div>;
}

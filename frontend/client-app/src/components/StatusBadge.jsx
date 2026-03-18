import clsx from 'clsx';
import { getStatusMeta } from '../utils/channelStatus.js';

export default function StatusBadge({ status }) {
  const meta = getStatusMeta(status);

  return (
    <span
      className={clsx(
        'px-2 py-1 rounded text-xs font-medium',
        meta.color === 'green' && 'bg-green-100 text-green-700',
        meta.color === 'orange' && 'bg-orange-100 text-orange-700',
        meta.color === 'red' && 'bg-red-100 text-red-700',
        meta.color === 'gray' && 'bg-gray-100 text-gray-700',
      )}
      style={{ backgroundColor: 'transparent', color: 'inherit' }}
    >
      {meta.label}
    </span>
  );
}


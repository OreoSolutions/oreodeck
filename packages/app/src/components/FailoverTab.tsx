import { useEffect, useState } from "react";
import { getFailover, setFailoverEnabled, setFailoverOrder } from "../lib/api";
import { moveItem } from "../lib/reorder";

export default function FailoverTab() {
  const [enabled, setEnabled] = useState(true);
  const [order, setOrder] = useState<string[]>([]);

  const reload = () =>
    getFailover()
      .then((f) => {
        setEnabled(f.enabled);
        setOrder(f.order);
      })
      .catch(() => {});

  useEffect(() => {
    reload();
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await setFailoverEnabled(next).catch(() => {});
  };

  const move = async (from: number, to: number) => {
    const next = moveItem(order, from, to);
    setOrder(next);
    await setFailoverOrder(next).catch(() => {});
  };

  return (
    <section>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          aria-label="failover enabled"
        />{" "}
        Automatic failover
      </label>
      <ol>
        {order.map((name, i) => (
          <li
            key={name}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              move(Number(e.dataTransfer.getData("text/plain")), i);
            }}
          >
            {name}
            <button aria-label={`move ${name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
              ↑
            </button>
            <button
              aria-label={`move ${name} down`}
              disabled={i === order.length - 1}
              onClick={() => move(i, i + 1)}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

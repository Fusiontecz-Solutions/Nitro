import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

const REORDER_SPRING = {
    type: "spring" as const,
    stiffness: 420,
    damping: 34,
    mass: 0.55,
};

export function AddendumSendOrderBoard<T extends { id: string }>({
    items,
    onReorder,
    disabled,
    renderItem,
}: {
    items: T[];
    onReorder: (next: T[]) => void;
    disabled?: boolean;
    renderItem: (item: T, index: number) => ReactNode;
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [localItems, setLocalItems] = useState(items);
    const localItemsRef = useRef(items);
    const originItemsRef = useRef<T[] | null>(null);

    localItemsRef.current = localItems;

    useEffect(() => {
        if (draggingId) return;
        setLocalItems(items);
    }, [items, draggingId]);

    const canReorder = !disabled && localItems.length > 1;

    const commitIfChanged = (next: T[]) => {
        const origin = originItemsRef.current;
        originItemsRef.current = null;
        if (!origin) return;
        const changed =
            origin.length !== next.length ||
            origin.some((item, index) => item.id !== next[index]?.id);
        if (changed) onReorder(next);
    };

    const moveByKeyboard = (id: string, direction: -1 | 1) => {
        if (!canReorder) return;
        const from = localItemsRef.current.findIndex((row) => row.id === id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= localItemsRef.current.length) return;
        const next = [...localItemsRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        originItemsRef.current = localItemsRef.current;
        localItemsRef.current = next;
        setLocalItems(next);
        commitIfChanged(next);
    };

    return (
        <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-2 dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <div className="mb-2 flex items-start justify-between gap-2 px-1">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
                        Send order
                    </p>
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                        {canReorder
                            ? "Drag to set which addendum is 1st, 2nd, and so on. SignNow sends the group in this order after the contract."
                            : "Position 1 is attached first after the contract."}
                    </p>
                </div>
            </div>
            <Reorder.Group
                as="ol"
                axis="y"
                values={localItems}
                onReorder={(next) => {
                    localItemsRef.current = next;
                    setLocalItems(next);
                }}
                layoutScroll
                className="space-y-2"
                aria-label="Addendum SignNow send order"
            >
                {localItems.map((item, index) => (
                    <AddendumSendOrderCard
                        key={item.id}
                        item={item}
                        index={index}
                        canReorder={canReorder}
                        dragging={draggingId === item.id}
                        renderItem={renderItem}
                        onDragStart={() => {
                            originItemsRef.current = localItemsRef.current;
                            setDraggingId(item.id);
                        }}
                        onDragEnd={() => {
                            setDraggingId(null);
                            commitIfChanged(localItemsRef.current);
                        }}
                        onKeyboardMove={moveByKeyboard}
                    />
                ))}
            </Reorder.Group>
        </div>
    );
}

function AddendumSendOrderCard<T extends { id: string }>({
    item,
    index,
    canReorder,
    dragging,
    renderItem,
    onDragStart,
    onDragEnd,
    onKeyboardMove,
}: {
    item: T;
    index: number;
    canReorder: boolean;
    dragging: boolean;
    renderItem: (item: T, index: number) => ReactNode;
    onDragStart: () => void;
    onDragEnd: () => void;
    onKeyboardMove: (id: string, direction: -1 | 1) => void;
}) {
    const controls = useDragControls();

    const startHandleDrag = (event: PointerEvent<HTMLButtonElement>) => {
        if (!canReorder || event.button !== 0) return;
        controls.start(event);
    };

    return (
        <Reorder.Item
            as="li"
            value={item}
            dragListener={false}
            dragControls={controls}
            dragElastic={0.12}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            transition={REORDER_SPRING}
            whileDrag={{
                scale: 1.025,
                zIndex: 40,
                boxShadow: "0 16px 32px rgba(79, 70, 229, 0.22)",
                cursor: "grabbing",
            }}
            className={cn(
                "relative list-none rounded-lg",
                dragging && "ring-2 ring-indigo-400/70",
            )}
        >
            <div className="flex items-stretch gap-1.5">
                <button
                    type="button"
                    aria-label={`Drag to change send position of addendum ${index + 1}`}
                    disabled={!canReorder}
                    className={cn(
                        "flex w-6 shrink-0 touch-none select-none items-center justify-center rounded-md text-indigo-400 transition-colors",
                        canReorder
                            ? "cursor-grab hover:bg-indigo-100 hover:text-indigo-700 active:cursor-grabbing dark:hover:bg-indigo-900/50"
                            : "cursor-default opacity-40",
                    )}
                    onPointerDown={startHandleDrag}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            onKeyboardMove(item.id, -1);
                        } else if (event.key === "ArrowDown") {
                            event.preventDefault();
                            onKeyboardMove(item.id, 1);
                        }
                    }}
                >
                    <GripVertical className="h-4 w-4" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
            </div>
        </Reorder.Item>
    );
}

'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  fetchContractEvents,
  type ContractEventRecord,
} from '@/lib/transaction_builder';
import { CONTRACT_ID, RPC_URL } from '@/constants/network';

const PAGE_SIZE = 10;
const DEFAULT_START_LEDGER = Number(
  process.env.NEXT_PUBLIC_EVENT_START_LEDGER ?? 0
);

const EVENT_STYLES: Record<ContractEventRecord['type'], string> = {
  created: 'bg-green-900/70 text-green-200 border-green-700',
  renewed: 'bg-blue-900/70 text-blue-200 border-blue-700',
  cancelled: 'bg-red-900/70 text-red-200 border-red-700',
  expired: 'bg-amber-900/70 text-amber-200 border-amber-700',
  unknown: 'bg-gray-800 text-gray-200 border-gray-700',
};

export default function EventHistory() {
  const [events, setEvents] = useState<ContractEventRecord[]>([]);
  const [page, setPage] = useState(0);
  const [focusedRow, setFocusedRow] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const pageEvents = useMemo(
    () => events.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [events, page]
  );

  async function loadEvents() {
    setIsLoading(true);
    setError(null);

    try {
      const nextEvents = await fetchContractEvents(
        CONTRACT_ID,
        RPC_URL,
        DEFAULT_START_LEDGER
      );
      setEvents(nextEvents);
      setPage(0);
      setFocusedRow(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Could not load contract events: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }

  function exportCsv() {
    const headers = ['event_type', 'timestamp', 'ledger', 'subscriber', 'amount'];
    const rows = events.map((event) => [
      event.type,
      event.timestamp,
      String(event.ledger),
      event.subscriber,
      event.amount,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `subscription-events-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleTableKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedRow((row) => Math.min(row + 1, pageEvents.length - 1));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedRow((row) => Math.max(row - 1, 0));
    }
  }

  return (
    <section className="w-full max-w-4xl mt-8 rounded-2xl bg-gray-900 p-6 text-white shadow-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Event History</h2>
          <p className="mt-1 text-sm text-gray-400">
            Audit subscription lifecycle events emitted by the contract.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadEvents}
            disabled={isLoading || !CONTRACT_ID}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition-colors
                       hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50
                       focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {isLoading ? 'Loading…' : 'Refresh events'}
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={events.length === 0}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold transition-colors
                       hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50
                       focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Export CSV
          </button>
        </div>
      </div>

      {!CONTRACT_ID && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-700 bg-amber-900/60 p-3 text-sm text-amber-100"
        >
          Set NEXT_PUBLIC_CONTRACT_ID to load contract events.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-700 bg-red-900/60 p-3 text-sm text-red-100"
        >
          {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table
          aria-label="Subscription contract event history"
          tabIndex={0}
          onKeyDown={handleTableKeyDown}
          className="min-w-full border-collapse text-left text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <thead className="text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th scope="col" className="border-b border-gray-800 px-3 py-2">
                Event
              </th>
              <th scope="col" className="border-b border-gray-800 px-3 py-2">
                Timestamp
              </th>
              <th scope="col" className="border-b border-gray-800 px-3 py-2">
                Subscriber
              </th>
              <th scope="col" className="border-b border-gray-800 px-3 py-2">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {pageEvents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                  {isLoading ? 'Loading events…' : 'No events loaded yet.'}
                </td>
              </tr>
            ) : (
              pageEvents.map((event, index) => (
                <tr
                  key={event.id}
                  aria-selected={focusedRow === index}
                  className={
                    focusedRow === index
                      ? 'bg-gray-800/80'
                      : 'odd:bg-gray-950/30'
                  }
                >
                  <td className="border-b border-gray-800 px-3 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${EVENT_STYLES[event.type]}`}
                    >
                      {event.type}
                    </span>
                  </td>
                  <td className="border-b border-gray-800 px-3 py-3 text-gray-300">
                    {event.timestamp}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-3">
                    <span className="font-mono text-xs text-gray-300">
                      {event.subscriber}
                    </span>
                  </td>
                  <td className="border-b border-gray-800 px-3 py-3 text-gray-300">
                    {event.amount}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
        <span>
          Page {page + 1} of {pageCount}
        </span>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={page === 0}
            className="rounded border border-gray-700 px-3 py-1 hover:bg-gray-800
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() =>
              setPage((value) => Math.min(pageCount - 1, value + 1))
            }
            disabled={page >= pageCount - 1}
            className="rounded border border-gray-700 px-3 py-1 hover:bg-gray-800
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

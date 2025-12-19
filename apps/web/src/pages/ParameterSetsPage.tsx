import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiCreateParameterSet, apiGetParameterSet, apiListParameterSets, type ParameterSet } from "../lib/dstbApi";
import { getRecordProp, isRecord, isString } from "../lib/typeGuards";
import { parseStrategyParams } from "../domain/strategyParams";

function extractSymbolInterval(params: unknown): Readonly<{ symbol: string | null; interval: string | null }> {
  const parsed = parseStrategyParams(params);

  if (parsed) {
    return {
      symbol: parsed.symbol,
      interval: parsed.interval
    };
  }

  if (!isRecord(params)) {
    return { symbol: null, interval: null };
  }

  const symbol = getRecordProp(params, "symbol");
  const interval = getRecordProp(params, "interval");

  return {
    symbol: isString(symbol) ? symbol : null,
    interval: isString(interval) ? interval : null
  };
}

function copyName(original: string): string {
  const trimmed = original.trim();
  return trimmed.length > 0 ? `${trimmed} (copy)` : "Copy";
}

/**
 * Parameter Sets list screen.
 */
export function ParameterSetsPage(): React.ReactElement {
  const navigate = useNavigate();

  const [items, setItems] = useState<readonly ParameterSet[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [offset, setOffset] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const limit = 25;

  const canLoadMore = useMemo(() => {
    return items.length < total;
  }, [items.length, total]);

  const load = useCallback(
    async (nextOffset: number) => {
      setIsLoading(true);
      setError(null);

      try {
        const page = await apiListParameterSets(nextOffset, limit);

        setItems((prev) => {
          if (nextOffset === 0) {
            return page.items;
          }

          return [...prev, ...page.items];
        });
        setTotal(page.total);
        setOffset(page.offset);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load parameter sets");
      } finally {
        setIsLoading(false);
      }
    },
    [limit]
  );

  const onDuplicate = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const existing = await apiGetParameterSet(id);
        const parsed = parseStrategyParams(existing.params);

        if (!parsed) {
          throw new Error("Cannot duplicate: stored params are not a valid StrategyParams object");
        }

        const created = await apiCreateParameterSet({
          ...(existing.description ? { description: existing.description } : {}),
          name: copyName(existing.name),
          params: parsed
        });

        // Navigate to the new editor (edit mode is view-only for now).
        navigate(`/parameter-sets/${created.id}`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to duplicate parameter set");
      } finally {
        setIsLoading(false);
      }
    },
    [navigate]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="col">
          <p className="h1" style={{ marginBottom: 2 }}>
            Parameter Sets
          </p>
          <span className="muted">Create and reuse strategy configurations.</span>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="button" onClick={() => void load(0)} disabled={isLoading}>
            Refresh
          </button>
          <Link className="btn btnPrimary" to="/parameter-sets/new">
            Create new
          </Link>
        </div>
      </div>

      <div className="hr" />

      {error ? <div className="errorBox">{error}</div> : null}

      <div className="card">
        <div className="cardBody">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Symbol</th>
                <th>Interval</th>
                <th>Updated</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ps) => {
                const si = extractSymbolInterval(ps.params);

                return (
                  <tr key={ps.id}>
                    <td>{ps.name}</td>
                    <td className="muted">{si.symbol ?? "-"}</td>
                    <td className="muted">{si.interval ?? "-"}</td>
                    <td className="muted">{ps.updatedAt}</td>
                    <td className="muted">{ps.description ?? ""}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <Link className="btn" to={`/parameter-sets/${ps.id}`}>
                          Open
                        </Link>
                        <button className="btn" type="button" onClick={() => void onDuplicate(ps.id)} disabled={isLoading}>
                          Duplicate
                        </button>
                        <button
                          className="btn btnDanger"
                          type="button"
                          disabled
                          title="Delete endpoint is not defined in v1 API contracts (soft delete is recommended but not specified)."
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {items.length === 0 && isLoading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Loading...
                  </td>
                </tr>
              ) : null}

              {items.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No parameter sets yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {`Showing ${items.length} of ${total}`}
            </span>
            <button
              className="btn"
              type="button"
              disabled={!canLoadMore || isLoading}
              onClick={() => void load(offset + items.length)}
            >
              {isLoading ? "Loading..." : "Load more"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

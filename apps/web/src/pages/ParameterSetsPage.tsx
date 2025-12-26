import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Sparkles, Copy, ExternalLink } from "lucide-react";

import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { StrategyCard } from "../components/design/StrategyCard";
import { apiCreateParameterSet, apiGetParameterSet, apiListParameterSets, type ParameterSet } from "../lib/dstbApi";
import { getRecordProp, isRecord, isString } from "../lib/typeGuards";
import { parseStrategyParams } from "../domain/strategyParams";
import { PRESET_CONFIGS } from "../lib/presetConfigs";

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
 * Strategies page - displays preset templates and saved parameter sets.
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

  const onCreateFromPreset = useCallback(
    async (presetId: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const preset = PRESET_CONFIGS.find((p) => p.id === presetId);
        if (!preset) {
          throw new Error("Preset not found");
        }

        const created = await apiCreateParameterSet({
          name: preset.name,
          description: preset.description,
          params: preset.params
        });

        navigate(`/parameter-sets/${created.id}`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create from preset");
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
    <div className="page-container">
      <PageHeader
        title="Strategies"
        description="Pre-configured templates and your saved strategy configurations"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void load(0)} disabled={isLoading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button asChild>
              <Link to="/parameter-sets/new">
                <Plus className="h-4 w-4 mr-2" />
                Create New
              </Link>
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5 p-4">
          <p className="text-small text-destructive">{error}</p>
        </Card>
      )}

      {/* Quick Start Templates */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>Quick Start Templates</CardTitle>
          </div>
          <CardDescription>
            Pre-configured strategies ready to backtest. Click any template to create your own copy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PRESET_CONFIGS.map((preset) => (
              <StrategyCard
                key={preset.id}
                name={preset.name}
                description={preset.description}
                onClick={() => void onCreateFromPreset(preset.id)}
                icon="⚡"
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* My Strategies Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>My Strategies</CardTitle>
              <CardDescription className="mt-1">
                Your saved parameter sets and configurations
              </CardDescription>
            </div>
            <Badge variant="secondary">
              {total} {total === 1 ? "strategy" : "strategies"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 text-small font-semibold">Name</th>
                  <th className="pb-3 text-small font-semibold">Symbol</th>
                  <th className="pb-3 text-small font-semibold">Interval</th>
                  <th className="pb-3 text-small font-semibold">Updated</th>
                  <th className="pb-3 text-small font-semibold">Description</th>
                  <th className="pb-3 text-small font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((ps) => {
                  const si = extractSymbolInterval(ps.params);

                  return (
                    <tr key={ps.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-4 text-small font-medium">{ps.name}</td>
                      <td className="py-4 text-small text-muted-foreground">
                        {si.symbol ? (
                          <Badge variant="outline">{si.symbol}</Badge>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                      <td className="py-4 text-small text-muted-foreground">
                        {si.interval ? (
                          <Badge variant="outline">{si.interval}</Badge>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                      <td className="py-4 text-caption text-muted-foreground">
                        {new Date(ps.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="py-4 text-small text-muted-foreground max-w-xs truncate">
                        {ps.description || <span className="italic">No description</span>}
                      </td>
                      <td className="py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/parameter-sets/${ps.id}`}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Open
                            </Link>
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => void onDuplicate(ps.id)} 
                            disabled={isLoading}
                          >
                            <Copy className="h-4 w-4 mr-1" />
                            Duplicate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {items.length === 0 && isLoading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      Loading strategies...
                    </td>
                  </tr>
                )}

                {items.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-muted-foreground">No strategies yet</p>
                        <p className="text-small text-muted-foreground">
                          Use the quick start templates above to get started!
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {items.length > 0 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <p className="text-caption text-muted-foreground">
                Showing {items.length} of {total} {total === 1 ? "strategy" : "strategies"}
              </p>
              {canLoadMore && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => void load(offset + items.length)}
                >
                  {isLoading ? "Loading..." : "Load More"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}





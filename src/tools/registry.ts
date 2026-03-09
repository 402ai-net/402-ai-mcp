import type { AlbomConfig } from "../config.js";
import { NwcAutoTopupManager } from "../autoTopup.js";
import { buildToolState } from "../dedup.js";
import { AlbomHttpClient } from "../httpClient.js";
import type { CatalogState, ToolState } from "../types.js";
import { AlbomToolExecutor } from "./executor.js";
import { registerPlannedTool, type RegisteredToolHandle, type ToolServerLike } from "./registration.js";

interface CatalogProvider {
  getState: (options?: { refresh?: boolean }) => Promise<CatalogState>;
  snapshot: () => CatalogState | undefined;
}

interface ToolRegistryOptions {
  config: AlbomConfig;
  server: ToolServerLike;
  catalogProvider: CatalogProvider;
  httpClient: AlbomHttpClient;
}

export class AlbomToolRegistry {
  private readonly config: AlbomConfig;
  private readonly server: ToolServerLike;
  private readonly catalogProvider: CatalogProvider;
  private readonly httpClient: AlbomHttpClient;
  private readonly autoTopupManager?: NwcAutoTopupManager;

  private toolState: ToolState | undefined;
  private catalogState: CatalogState | undefined;
  private registeredTools: RegisteredToolHandle[] = [];

  public constructor(options: ToolRegistryOptions) {
    this.config = options.config;
    this.server = options.server;
    this.catalogProvider = options.catalogProvider;
    this.httpClient = options.httpClient;
    if (this.config.nwcUri) {
      this.autoTopupManager = new NwcAutoTopupManager(
        {
          nwcUri: this.config.nwcUri,
          thresholdSats: this.config.nwcThresholdSats,
          topupUsd: this.config.nwcTopupUsd,
          maxDailyUsd: this.config.nwcMaxDailyUsd
        },
        this.httpClient
      );
    }
  }

  public currentToolState(): ToolState | undefined {
    return this.toolState;
  }

  public async initialize(): Promise<void> {
    await this.syncTools({ forceRefresh: true, emitNotification: false });
  }

  public async syncTools(options: { forceRefresh: boolean; emitNotification: boolean }): Promise<boolean> {
    const catalogState = await this.catalogProvider.getState({ refresh: options.forceRefresh });
    this.catalogState = catalogState;

    const nextToolState = buildToolState(catalogState, this.config);
    const changed = this.toolState?.signature !== nextToolState.signature;

    if (!changed) {
      return false;
    }

    this.replaceRegisteredTools(nextToolState);

    const hadPreviousToolState = Boolean(this.toolState);
    this.toolState = nextToolState;

    if (options.emitNotification && hadPreviousToolState && this.server.isConnected()) {
      this.server.sendToolListChanged();
    }

    return true;
  }

  public dispose(): void {
    for (const handle of this.registeredTools) {
      handle.remove();
    }

    this.registeredTools = [];
  }

  private replaceRegisteredTools(nextToolState: ToolState): void {
    for (const existing of this.registeredTools) {
      existing.remove();
    }

    this.registeredTools = [];

    const executor = new AlbomToolExecutor({
      config: this.config,
      httpClient: this.httpClient,
      getCatalogState: () => {
        if (!this.catalogState) {
          throw new Error("Catalog state is not initialized");
        }
        return this.catalogState;
      },
      refreshCatalog: async () => {
        const refreshed = await this.catalogProvider.getState({ refresh: true });
        this.catalogState = refreshed;
        return refreshed;
      },
      getToolState: () => this.toolState,
      autoTopupManager: this.autoTopupManager
    });

    for (const tool of nextToolState.tools) {
      this.registeredTools.push(registerPlannedTool(this.server, tool, executor));
    }
  }
}

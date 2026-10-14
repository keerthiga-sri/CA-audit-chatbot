/**
 * Centralized in-memory fallback store for Clients, Financials, and Chunks
 * Used when Supabase is offline or environment variables are not yet configured on Vercel.
 */

export interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
  financialYearsAudited?: number;
  documentChunks?: number;
  hasDocuments?: boolean;
}

export interface FinancialRecord {
  client_id: string;
  year: number;
  income: number | null;
  profit: number | null;
  loss: number | null;
}

export interface ChunkRecord {
  client_id: string;
  content: string;
  embedding: number[] | string;
}

// Pre-seeded with sample clients and 10-year audit history
const memoryClients: ClientRecord[] = [
  {
    id: "sample-apex-001",
    name: "Apex Enterprises Pvt Ltd",
    email: "finance@apexenterprises.com",
    created_at: "2026-10-01T04:26:26.807Z",
    financialYearsAudited: 10,
    documentChunks: 12,
    hasDocuments: true,
  },
  {
    id: "sample-zenith-002",
    name: "Zenith Logistics Ltd",
    email: "audit@zenithlogistics.in",
    created_at: "2026-10-05T10:00:00.000Z",
    financialYearsAudited: 10,
    documentChunks: 10,
    hasDocuments: true,
  },
];

// Sample 10-year financials for Apex Enterprises Pvt Ltd (FY 2015 to FY 2024)
const memoryFinancials: FinancialRecord[] = [
  { client_id: "sample-apex-001", year: 2015, income: 12500000, profit: 1420000, loss: 0 },
  { client_id: "sample-apex-001", year: 2016, income: 14800000, profit: 1850000, loss: 0 },
  { client_id: "sample-apex-001", year: 2017, income: 18200000, profit: 2300000, loss: 0 },
  { client_id: "sample-apex-001", year: 2018, income: 21500000, profit: 2750000, loss: 0 },
  { client_id: "sample-apex-001", year: 2019, income: 25800000, profit: 3400000, loss: 0 },
  { client_id: "sample-apex-001", year: 2020, income: 22100000, profit: 0, loss: 950000 },
  { client_id: "sample-apex-001", year: 2021, income: 28400000, profit: 3100000, loss: 0 },
  { client_id: "sample-apex-001", year: 2022, income: 36500000, profit: 4850000, loss: 0 },
  { client_id: "sample-apex-001", year: 2023, income: 44200000, profit: 6200000, loss: 0 },
  { client_id: "sample-apex-001", year: 2024, income: 52800000, profit: 7900000, loss: 0 },
];

const memoryChunks: ChunkRecord[] = [];

export const memoryStore = {
  getClients(): ClientRecord[] {
    return memoryClients;
  },

  findClient(idOrName: string): ClientRecord | undefined {
    const clean = idOrName.trim().toLowerCase();
    return memoryClients.find(
      (c) => c.id === idOrName || c.name.toLowerCase() === clean || c.name.toLowerCase().includes(clean)
    );
  },

  addClient(name: string, email: string | null = null): ClientRecord {
    const existing = this.findClient(name);
    if (existing) return existing;

    const newClient: ClientRecord = {
      id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      email: email ? email.trim() : null,
      created_at: new Date().toISOString(),
      financialYearsAudited: 0,
      documentChunks: 0,
      hasDocuments: false,
    };
    memoryClients.unshift(newClient);
    return newClient;
  },

  getFinancials(clientId: string): FinancialRecord[] {
    return memoryFinancials
      .filter((f) => f.client_id === clientId)
      .sort((a, b) => a.year - b.year);
  },

  saveFinancials(
    clientId: string,
    rows: Array<{ year: number; income?: number | null; profit?: number | null; loss?: number | null }>
  ): void {
    // Remove existing
    for (let i = memoryFinancials.length - 1; i >= 0; i--) {
      if (memoryFinancials[i].client_id === clientId) {
        memoryFinancials.splice(i, 1);
      }
    }
    // Add new
    for (const r of rows) {
      memoryFinancials.push({
        client_id: clientId,
        year: r.year,
        income: r.income ?? null,
        profit: r.profit ?? null,
        loss: r.loss ?? null,
      });
    }

    const client = memoryClients.find((c) => c.id === clientId);
    if (client) {
      client.financialYearsAudited = rows.length;
      client.hasDocuments = rows.length > 0;
    }
  },

  saveChunks(clientId: string, chunks: Array<{ content: string; embedding: number[] | string }>): void {
    for (let i = memoryChunks.length - 1; i >= 0; i--) {
      if (memoryChunks[i].client_id === clientId) {
        memoryChunks.splice(i, 1);
      }
    }
    for (const c of chunks) {
      memoryChunks.push({
        client_id: clientId,
        content: c.content,
        embedding: c.embedding,
      });
    }

    const client = memoryClients.find((c) => c.id === clientId);
    if (client) {
      client.documentChunks = chunks.length;
      client.hasDocuments = chunks.length > 0;
    }
  },

  getChunks(clientId: string): ChunkRecord[] {
    return memoryChunks.filter((c) => c.client_id === clientId);
  },
};

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OperationInProgressError,
  OperationLeaseLostError,
  withUserOperationLease,
} from "@/lib/operation-security";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("lease distribuído de operações", () => {
  let userId = "";

  beforeAll(async () => {
    const user = await db!.user.create({
      data: { email: `lease-${randomUUID()}@example.com` },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.userOperationLease.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("renova o lease enquanto a ação continua e libera ao final", async () => {
    const operation = `heartbeat-${randomUUID()}`;
    let started!: () => void;
    const actionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = withUserOperationLease({
      userId,
      operation,
      leaseMs: 1_200,
      action: async (lease) => {
        await lease.assertOwned();
        started();
        await new Promise((resolve) => setTimeout(resolve, 1_800));
        expect(lease.signal.aborted).toBe(false);
        return "first";
      },
    });

    await actionStarted;
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    await expect(withUserOperationLease({
      userId,
      operation,
      leaseMs: 1_200,
      action: async () => "second",
    })).rejects.toBeInstanceOf(OperationInProgressError);
    await expect(first).resolves.toBe("first");

    await expect(withUserOperationLease({
      userId,
      operation,
      leaseMs: 1_200,
      action: async (lease) => {
        await lease.renew();
        return "after-release";
      },
    })).resolves.toBe("after-release");
  });

  it("possui FK de usuário com exclusão em cascata", async () => {
    const constraints = await db!.$queryRaw<Array<{ deleteAction: string }>>`
      SELECT rc.delete_rule AS "deleteAction"
      FROM information_schema.referential_constraints rc
      WHERE rc.constraint_name = 'UserOperationLease_userId_fkey'
    `;

    expect(constraints).toEqual([{ deleteAction: "CASCADE" }]);
  });

  it("impede gravações cercadas depois que o worker perde o lease", async () => {
    const operation = `fencing-${randomUUID()}`;
    await expect(withUserOperationLease({
      userId,
      operation,
      leaseMs: 10_000,
      action: async (lease) => {
        await db!.userOperationLease.update({
          where: { userId_operation: { userId, operation } },
          data: {
            id: randomUUID(),
            lockedUntil: new Date(Date.now() + 10_000),
          },
        });
        await expect(lease.runFencedTransaction(async (tx) => {
          await tx.user.update({ where: { id: userId }, data: { name: "não deve gravar" } });
        })).rejects.toBeInstanceOf(OperationLeaseLostError);
        throw new OperationLeaseLostError();
      },
    })).rejects.toBeInstanceOf(OperationLeaseLostError);

    expect((await db!.user.findUniqueOrThrow({ where: { id: userId } })).name).not.toBe("não deve gravar");
  });
});

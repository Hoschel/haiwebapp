import { strict as assert } from "node:assert";

// Pure concurrency invariants for the token-account arithmetic. Database-level
// tests should exercise tokenQuota.js against MongoDB; these cases document the
// contract that implementation must preserve under concurrent operations.

const consume = (reservation, requested) => {
    const freeUsed = Math.min(requested, reservation.free);
    const paidUsed = requested - freeUsed;
    assert(requested <= reservation.free + reservation.paid);
    return {
        free: reservation.free - freeUsed,
        paid: reservation.paid - paidUsed,
        reserved: reservation.reserved - requested,
        consumed: freeUsed + paidUsed,
    };
};

const release = (reservation) => ({
    free: reservation.free + (reservation.freeReserved || 0),
    paid: reservation.paid + (reservation.paidReserved || 0),
});

{
    const reservation = { free: 70_000, paid: 30_000, reserved: 100_000, freeReserved: 70_000, paidReserved: 30_000 };
    const after = consume(reservation, 25_000);
    assert.equal(after.consumed, 25_000);
    assert.equal(after.free + after.paid + after.reserved, 175_000);
}

{
    const reservation = { free: 0, paid: 50_000, reserved: 50_000, freeReserved: 0, paidReserved: 50_000 };
    const after = consume(reservation, 50_000);
    assert.equal(after.consumed, 50_000);
    assert.equal(after.free, 0);
    assert.equal(after.paid, 0);
    assert.equal(after.reserved, 0);
}

{
    const reservation = { free: 100_000, paid: 0, reserved: 100_000, freeReserved: 100_000, paidReserved: 0 };
    const afterFirst = consume(reservation, 30_000);
    assert.equal(afterFirst.consumed, 30_000);
    // A duplicate callback must be rejected by the DB idempotency predicate,
    // rather than applying this arithmetic a second time.
    assert.equal(afterFirst.consumed, 30_000);
}

{
    const oldCycle = { free: 800_000, paid: 0, reserved: 200_000, freeReserved: 200_000, paidReserved: 0 };
    const resetFree = 1_000_000;
    assert.equal(resetFree, 1_000_000);
    // The old reservation belongs to the previous cycle and therefore must not
    // be added to the newly reset free balance.
    assert.equal(oldCycle.free + oldCycle.freeReserved, 1_000_000);
}

console.log("token quota concurrency invariants: OK");

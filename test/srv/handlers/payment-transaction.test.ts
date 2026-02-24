/* eslint-disable @typescript-eslint/no-explicit-any */

import { PAYMENT_STATUS_TRANSITIONS, PAYMENT_TRANSACTION_STATUSES } from "@auto/shared";

describe("PaymentTransaction entity constraints", () => {
  describe("status transitions", () => {
    it("should define all 4 statuses", () => {
      expect(PAYMENT_TRANSACTION_STATUSES).toHaveLength(4);
      expect(PAYMENT_TRANSACTION_STATUSES).toEqual(["Pending", "Succeeded", "Failed", "Refunded"]);
    });

    it("should allow Pending -> Succeeded transition", () => {
      expect(PAYMENT_STATUS_TRANSITIONS["Pending"]).toContain("Succeeded");
    });

    it("should allow Pending -> Failed transition", () => {
      expect(PAYMENT_STATUS_TRANSITIONS["Pending"]).toContain("Failed");
    });

    it("should allow Succeeded -> Refunded transition", () => {
      expect(PAYMENT_STATUS_TRANSITIONS["Succeeded"]).toContain("Refunded");
    });

    it("should NOT allow Failed -> any transition", () => {
      expect(PAYMENT_STATUS_TRANSITIONS["Failed"]).toHaveLength(0);
    });

    it("should NOT allow Refunded -> any transition", () => {
      expect(PAYMENT_STATUS_TRANSITIONS["Refunded"]).toHaveLength(0);
    });

    it("should NOT allow backward transitions", () => {
      expect(PAYMENT_STATUS_TRANSITIONS["Succeeded"]).not.toContain("Pending");
      expect(PAYMENT_STATUS_TRANSITIONS["Failed"]).not.toContain("Pending");
      expect(PAYMENT_STATUS_TRANSITIONS["Refunded"]).not.toContain("Succeeded");
    });
  });

  describe("isValidTransition helper", () => {
    function isValidTransition(from: string, to: string): boolean {
      const allowed = PAYMENT_STATUS_TRANSITIONS[from];
      if (!allowed) return false;
      return allowed.includes(to);
    }

    it("should accept valid transitions", () => {
      expect(isValidTransition("Pending", "Succeeded")).toBe(true);
      expect(isValidTransition("Pending", "Failed")).toBe(true);
      expect(isValidTransition("Succeeded", "Refunded")).toBe(true);
    });

    it("should reject invalid transitions", () => {
      expect(isValidTransition("Failed", "Succeeded")).toBe(false);
      expect(isValidTransition("Refunded", "Pending")).toBe(false);
      expect(isValidTransition("Succeeded", "Pending")).toBe(false);
    });

    it("should reject unknown statuses", () => {
      expect(isValidTransition("Unknown", "Pending")).toBe(false);
    });
  });
});

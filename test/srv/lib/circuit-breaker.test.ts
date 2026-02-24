/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockGetConfigParam = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      log: jest.fn(() => mockLog),
    },
  };
});

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: any[]) => mockGetConfigParam(...args),
    getAll: jest.fn(() => []),
    invalidate: jest.fn(),
    refresh: jest.fn(),
    refreshTable: jest.fn(),
    isReady: jest.fn(() => true),
  },
}));

const {
  isCallAllowed,
  recordSuccess,
  recordFailure,
  getCircuitState,
  getConsecutiveFailures,
  resetAllCircuits,
  resetCircuit,
} = require("../../../srv/lib/circuit-breaker");

describe("circuit-breaker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfigParam.mockReset();
    resetAllCircuits();
  });

  describe("initial state", () => {
    it("should allow calls for unknown adapters (closed by default)", () => {
      expect(isCallAllowed("IEmissionAdapter")).toBe(true);
    });

    it("should report closed state for unknown adapters", () => {
      expect(getCircuitState("IEmissionAdapter")).toBe("closed");
    });

    it("should report 0 consecutive failures for unknown adapters", () => {
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(0);
    });
  });

  describe("recordSuccess", () => {
    it("should keep circuit closed after success", () => {
      recordSuccess("IEmissionAdapter");
      expect(getCircuitState("IEmissionAdapter")).toBe("closed");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(0);
    });

    it("should reset failure count on success", () => {
      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(2);

      recordSuccess("IEmissionAdapter");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(0);
    });
  });

  describe("recordFailure", () => {
    it("should increment consecutive failures", () => {
      recordFailure("IEmissionAdapter");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(1);

      recordFailure("IEmissionAdapter");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(2);
    });

    it("should open circuit after threshold failures (default 5)", () => {
      mockGetConfigParam.mockReturnValue(undefined);

      for (let i = 0; i < 4; i++) {
        recordFailure("IEmissionAdapter");
      }
      expect(getCircuitState("IEmissionAdapter")).toBe("closed");

      recordFailure("IEmissionAdapter");
      expect(getCircuitState("IEmissionAdapter")).toBe("open");
    });

    it("should use configured threshold", () => {
      mockGetConfigParam.mockImplementation((table: string, key: string) => {
        if (key === "CIRCUIT_BREAKER_THRESHOLD") return { value: "3" };
        return undefined;
      });

      recordFailure("IRecallAdapter");
      recordFailure("IRecallAdapter");
      expect(getCircuitState("IRecallAdapter")).toBe("closed");

      recordFailure("IRecallAdapter");
      expect(getCircuitState("IRecallAdapter")).toBe("open");
    });
  });

  describe("open circuit", () => {
    beforeEach(() => {
      mockGetConfigParam.mockImplementation((table: string, key: string) => {
        if (key === "CIRCUIT_BREAKER_THRESHOLD") return { value: "3" };
        if (key === "CIRCUIT_BREAKER_COOLDOWN_MS") return { value: "1000" };
        if (key === "CIRCUIT_BREAKER_HALF_OPEN_MAX") return { value: "1" };
        return undefined;
      });

      // Open the circuit
      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");
    });

    it("should block calls when circuit is open", () => {
      expect(isCallAllowed("IEmissionAdapter")).toBe(false);
    });

    it("should transition to half-open after cooldown", async () => {
      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 1100));

      expect(isCallAllowed("IEmissionAdapter")).toBe(true);
      expect(getCircuitState("IEmissionAdapter")).toBe("half-open");
    });
  });

  describe("half-open circuit", () => {
    beforeEach(async () => {
      mockGetConfigParam.mockImplementation((table: string, key: string) => {
        if (key === "CIRCUIT_BREAKER_THRESHOLD") return { value: "3" };
        if (key === "CIRCUIT_BREAKER_COOLDOWN_MS") return { value: "100" };
        if (key === "CIRCUIT_BREAKER_HALF_OPEN_MAX") return { value: "1" };
        return undefined;
      });

      // Open the circuit
      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");

      // Wait for cooldown to transition to half-open
      await new Promise((r) => setTimeout(r, 150));
      isCallAllowed("IEmissionAdapter"); // triggers transition
    });

    it("should allow a probe call in half-open", () => {
      expect(getCircuitState("IEmissionAdapter")).toBe("half-open");
      expect(isCallAllowed("IEmissionAdapter")).toBe(true);
    });

    it("should close circuit on success in half-open", () => {
      recordSuccess("IEmissionAdapter");
      expect(getCircuitState("IEmissionAdapter")).toBe("closed");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(0);
    });

    it("should re-open circuit on failure in half-open", () => {
      recordFailure("IEmissionAdapter");
      expect(getCircuitState("IEmissionAdapter")).toBe("open");
    });
  });

  describe("resetAllCircuits", () => {
    it("should clear all circuit states", () => {
      recordFailure("IEmissionAdapter");
      recordFailure("IRecallAdapter");
      resetAllCircuits();
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(0);
      expect(getConsecutiveFailures("IRecallAdapter")).toBe(0);
    });
  });

  describe("resetCircuit", () => {
    it("should clear state for a specific adapter", () => {
      recordFailure("IEmissionAdapter");
      recordFailure("IRecallAdapter");
      resetCircuit("IEmissionAdapter");
      expect(getConsecutiveFailures("IEmissionAdapter")).toBe(0);
      expect(getConsecutiveFailures("IRecallAdapter")).toBe(1);
    });
  });

  describe("independent adapters", () => {
    it("should track failures independently per adapter", () => {
      mockGetConfigParam.mockImplementation((table: string, key: string) => {
        if (key === "CIRCUIT_BREAKER_THRESHOLD") return { value: "3" };
        return undefined;
      });

      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");
      recordFailure("IEmissionAdapter");
      recordFailure("IRecallAdapter");

      expect(getCircuitState("IEmissionAdapter")).toBe("open");
      expect(getCircuitState("IRecallAdapter")).toBe("closed");
      expect(getConsecutiveFailures("IRecallAdapter")).toBe(1);
    });
  });
});

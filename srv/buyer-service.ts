import cds from "@sap/cds";

const LOG = cds.log("buyer");

/** Statuses accessible via direct URL */
const DIRECT_ACCESS_STATUSES = ["published", "sold"];

export default class BuyerServiceHandler extends cds.ApplicationService {
  async init() {
    // Filter listing access: search shows only published, direct URL allows published+sold
    this.before("READ", "Listings", this.filterListingAccess);
    this.on("getHistoryReport", this.handleGetHistoryReport);
    await super.init();
  }

  /**
   * Filter listing access based on how the listing is being accessed:
   * - By ID (direct URL): allow published + sold
   * - List/search: only published
   * - Archived: never accessible
   */
  private filterListingAccess = (req: cds.Request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (req as any).query;

    // Check if this is a single-entity access (by key/ID)
    const isSingleAccess = this.isSingleEntityAccess(query);

    if (isSingleAccess) {
      // Direct URL access: published + sold
      query.where({ status: { in: DIRECT_ACCESS_STATUSES } });
    } else {
      // Search / list: published only
      query.where({ status: "published" });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isSingleEntityAccess(query: any): boolean {
    try {
      const where = query?.SELECT?.where;
      if (!where || !Array.isArray(where)) return false;
      return where.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (clause: any) => clause?.ref && Array.isArray(clause.ref) && clause.ref.includes("ID"),
      );
    } catch {
      return false;
    }
  }

  private handleGetHistoryReport = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };
    const userId = req.user?.id;

    if (!userId) {
      return req.error(401, "Rapport disponible - connectez-vous pour consulter");
    }

    const entities = cds.entities("auto");

    // Verify listing exists and is published or sold
    const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

    if (!listing) {
      return req.error(404, "Listing not found");
    }

    if (!DIRECT_ACCESS_STATUSES.includes(listing.status)) {
      return req.error(403, "History report is only available for published or sold listings");
    }

    // Fetch the history report
    const report = await cds.run(SELECT.one.from(entities["HistoryReport"]).where({ listingId }));

    if (!report) {
      return req.error(404, "No history report available for this listing");
    }

    LOG.info(`Buyer ${userId} accessed history report for listing ${listingId}`);

    return {
      reportId: report.ID,
      source: report.source,
      fetchedAt: report.fetchedAt,
      reportVersion: report.reportVersion,
      reportData: report.reportData,
      isMockData: report.source === "mock",
    };
  };
}

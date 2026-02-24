import cds from "@sap/cds";

const LOG = cds.log("buyer");

export default class BuyerServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("getHistoryReport", this.handleGetHistoryReport);
    await super.init();
  }

  private handleGetHistoryReport = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };
    const userId = req.user?.id;

    if (!userId) {
      return req.error(401, "Rapport disponible - connectez-vous pour consulter");
    }

    const entities = cds.entities("auto");

    // Verify listing exists and is published
    const listing = await cds.run(
      SELECT.one.from(entities["Listing"]).where({ ID: listingId }),
    );

    if (!listing) {
      return req.error(404, "Listing not found");
    }

    if (listing.status !== "published") {
      return req.error(403, "History report is only available for published listings");
    }

    // Fetch the history report
    const report = await cds.run(
      SELECT.one.from(entities["HistoryReport"]).where({ listingId }),
    );

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

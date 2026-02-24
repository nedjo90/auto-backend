import cds from "@sap/cds";
import { handleGetListings, handleGetListingDetail } from "./handlers/catalog-handler";

const LOG = cds.log("catalog");

export default class CatalogServiceHandler extends cds.ApplicationService {
  async init() {
    // Public listing browsing: only published listings
    this.before("READ", "Listings", this.filterPublishedOnly);

    // Action handlers
    this.on("getListings", handleGetListings);
    this.on("getListingDetail", handleGetListingDetail);

    LOG.info("CatalogService initialized");
    await super.init();
  }

  private filterPublishedOnly = (req: cds.Request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (req as any).query;
    query.where({ status: "published" });
  };
}

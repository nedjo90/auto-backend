using {auto} from '../db/schema';

@path    : '/api/catalog'
service CatalogService {
  /** Published listings (public, read-only) */
  @readonly
  entity Listings as projection on auto.Listing;

  /** Card configuration (public, read-only) */
  @readonly
  entity ConfigListingCards as projection on auto.ConfigListingCard;

  /** Get published listings with pagination for infinite scroll */
  action getListings(
    skip   : Integer,
    top    : Integer,
    search : String(200)
  ) returns {
    items   : LargeString;   // JSON array of IPublicListingCard
    total   : Integer;
    skip    : Integer;
    top     : Integer;
    hasMore : Boolean;
  };

  /** Get a single listing with full detail for the detail page */
  action getListingDetail(
    listingId : String(36) not null
  ) returns {
    listing : LargeString;   // JSON: IPublicListingDetail
  };
}

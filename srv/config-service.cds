using {auto} from '../db/schema';

@path    : '/api/config'
@requires: 'any'
service ConfigService {
  @readonly entity SessionParameters as projection on auto.ConfigParameter
    where ![key] like 'session.%';
}

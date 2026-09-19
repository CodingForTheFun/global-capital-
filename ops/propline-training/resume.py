"""Existing isolated one-shot job with current-board preflight and strict review."""
import run as runtime
from chunked_export import make_exporter
from website_smoke import verify_website
from candidate_review import review_candidate


def main():
    runtime.website_preflight = lambda: verify_website(stopped=runtime.Stopped)
    original_train = runtime.train_family

    def reviewed_train(records):
        info, artifact = review_candidate(*original_train(records))
        if info.get('status') == 'trained_candidate':
            runtime.log('HELD_OUT_VALIDATION', market=records[0]['family'],
                        classifier=info.get('classifier'), test=info.get('test'),
                        gates=info.get('gates'), qualityGatePassed=info.get('qualityGatePassed', False),
                        validationPolicy=info.get('validationPolicy'),
                        profitabilityValidated=False, productionEligible=False)
        return info, artifact

    runtime.train_family = reviewed_train
    runtime.export_sport = make_exporter(
        runtime.export_sport, runtime.REFERENCE_BOOKS,
        runtime.Stopped, runtime.StoreFailure, runtime.log,
    )
    runtime.main()


if __name__ == '__main__':
    try:
        main()
    except runtime.StoreFailure as error:
        runtime.log('STOPPED_PRIVATE_PERSISTENCE', reason=str(error))
    except runtime.Stopped as error:
        runtime.log('STOPPED_PREFLIGHT', reason=str(error))
    except Exception as error:
        runtime.log('STOPPED_UNEXPECTED', errorType=type(error).__name__)

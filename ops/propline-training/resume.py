"""Entry point for the existing isolated one-shot job, with resumable exports."""
import run as runtime
from chunked_export import make_exporter


def main():
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

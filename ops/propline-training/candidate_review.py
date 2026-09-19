"""Additive, fail-closed candidate review; no registry or inference writes."""
import hashlib
import math
from pathlib import Path

POLICY = 'strict-book-superiority-v1'

def review_candidate(info, artifact):
    if info.get('status') != 'trained_candidate':
        return info, artifact
    test = info.get('test', {})
    values = [test.get(k) for k in ('brier', 'bookBrier', 'brierDeltaUpper95')]
    finite = all(isinstance(v, (int, float)) and not isinstance(v, bool)
                 and math.isfinite(v) for v in values)
    # The previous +0.005 tolerance did not establish superiority. Require
    # an interval wholly below zero, while retaining every existing gate.
    strict = bool(finite and values[0] < values[1] and values[2] < 0)
    gates = dict(info.get('gates', {}))
    required = {'testObservations', 'testEvents', 'brier', 'beatsBook', 'calibration', 'eventBootstrap'}
    gates['strictBookSuperiority'] = strict
    info.update(gates=gates,
                qualityGatePassed=required.issubset(gates) and all(v is True for v in gates.values()),
                validationPolicy=POLICY,
                validationPolicySha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                profitabilityValidated=False, productionEligible=False)
    info['withheldReason'] = ('Private candidate only. Historical Brier superiority is not proof of '
                              'profitable execution. Real-price profitability, multiple-testing review, '
                              'model registry/inference integration and live feature parity remain required.')
    if artifact is not None:
        artifact['metadata'] = info
    return info, artifact

"""Synthetic offline regressions; never evidence of real model performance."""
import unittest
import requests
from website_smoke import ORIGIN, MIB, board_signature, verify_website
from candidate_review import review_candidate

PREMIUM = 'Loading prop board; data-player-card; No props match these filters.'

class Response:
    def __init__(self, body, status=200, media='application/javascript'):
        self.body = body.encode() if isinstance(body, str) else body
        self.status_code, self.headers, self.closed = status, {'content-type': media}, False
    def iter_content(self, chunk_size):
        for i in range(0, len(self.body), chunk_size):
            yield self.body[i:i+chunk_size]
    def close(self):
        self.closed = True

class SmokeTests(unittest.TestCase):
    def route(self, asset=PREMIUM, auth=401, code='AUTH_REQUIRED', page_status=200,
              src='/_next/static/chunks/board.js', asset_media='text/javascript'):
        calls = []
        responses = [Response('{"code":"'+code+'"}', auth, 'application/json'),
                     Response('<html><script src="'+src+'"></script></html>', page_status, 'text/html'),
                     Response(asset, media=asset_media)]
        def get(url, **kwargs):
            self.assertFalse(kwargs['allow_redirects'])
            self.assertTrue(kwargs['stream'])
            calls.append(url)
            return responses[len(calls)-1]
        return get, calls, responses
    def test_current_premium_and_legacy_boards(self):
        for asset, expected in [(PREMIUM, 'premium-player-board'), ('canonical-workspace-v1', 'canonical-workspace-v1')]:
            get, calls, responses = self.route(asset)
            result = verify_website(get=get)
            self.assertEqual(result['frontendSignature'], expected)
            self.assertEqual(len(result['canonicalWorkspaceAssetSha256']), 64)
            self.assertTrue(all(r.closed for r in responses))
    def test_partial_signature_rejected(self):
        self.assertIsNone(board_signature('data-player-card; Loading prop board'))
    def test_no_auth_bypass(self):
        for status, code in [(200, 'AUTH_REQUIRED'), (401, 'OTHER')]:
            get, calls, _ = self.route(auth=status, code=code)
            with self.assertRaisesRegex(RuntimeError, 'website_auth_verification_failed'):
                verify_website(get=get)
            self.assertEqual(len(calls), 1)
    def test_redirect_and_missing_page_rejected(self):
        for status in (302, 404, 500):
            get, _, _ = self.route(page_status=status)
            with self.assertRaisesRegex(RuntimeError, 'website_board_unavailable'):
                verify_website(get=get)
    def test_external_insecure_and_non_next_scripts_never_fetched(self):
        for src in ('https://evil.example/b.js', 'http://www.obligeprops.com/_next/b.js', '/api/other.js'):
            get, calls, _ = self.route(src=src)
            with self.assertRaisesRegex(RuntimeError, 'website_new_workspace_not_served'):
                verify_website(get=get)
            self.assertEqual(len(calls), 2)
    def test_html_disguised_as_javascript_rejected(self):
        get, _, _ = self.route(asset_media='text/html')
        with self.assertRaisesRegex(RuntimeError, 'website_new_workspace_not_served'):
            verify_website(get=get)
    def test_unknown_assets_fail_closed(self):
        get, _, _ = self.route(asset='other application')
        with self.assertRaisesRegex(RuntimeError, 'website_new_workspace_not_served'):
            verify_website(get=get)
    def test_response_byte_limit_closes_stream(self):
        get, _, responses = self.route(asset='x' * (5*MIB+1))
        with self.assertRaisesRegex(RuntimeError, 'website_smoke_byte_budget'):
            verify_website(get=get)
        self.assertTrue(responses[-1].closed)
    def test_network_failure_redacted(self):
        def get(*args, **kwargs):
            raise requests.ConnectionError('sensitive upstream detail')
        with self.assertRaisesRegex(RuntimeError, '^website_smoke_network$'):
            verify_website(get=get)

class CandidateTests(unittest.TestCase):
    def info(self, upper=-.001):
        return {'status':'trained_candidate', 'test':{'brier':.22,'bookBrier':.24,'brierDeltaUpper95':upper},
                'gates':{k:True for k in ('testObservations','testEvents','brier','beatsBook','calibration','eventBootstrap')},
                'qualityGatePassed':True, 'productionEligible':True}
    def test_tolerance_is_not_superiority(self):
        for upper in (.004, 0, float('nan'), float('inf'), None, True):
            info, _ = review_candidate(self.info(upper), {})
            self.assertFalse(info['qualityGatePassed'])
            self.assertFalse(info['productionEligible'])
    def test_strict_score_pass_is_still_not_profitability_or_production(self):
        info, artifact = review_candidate(self.info(), {})
        self.assertTrue(info['qualityGatePassed'])
        self.assertFalse(info['profitabilityValidated'])
        self.assertFalse(info['productionEligible'])
        self.assertIs(info, artifact['metadata'])
    def test_original_failures_and_missing_gates_preserved(self):
        for mode in ('failed', 'missing'):
            info = self.info()
            if mode == 'failed': info['gates']['testEvents'] = False
            else: del info['gates']['testEvents']
            reviewed, _ = review_candidate(info, {})
            self.assertFalse(reviewed['qualityGatePassed'])
    def test_no_candidate_is_not_invented(self):
        info = {'status':'insufficient_history'}
        self.assertEqual(review_candidate(info, None), (info, None))

if __name__ == '__main__':
    unittest.main()

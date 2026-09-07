import importlib.util,pathlib,unittest,io,urllib.request,urllib.error,http.client
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',pathlib.Path(__file__).with_name('swe-agent-v2.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class AgentChecks(unittest.TestCase):
    def test_transport_retry_preserves_request(self):
        req=urllib.request.Request('https://example.invalid',data=b'{}')
        with patch.object(a.urllib.request,'urlopen',side_effect=[http.client.IncompleteRead(b''),io.BytesIO(b'{"ok":true}')]) as opener,patch.object(a.time,'sleep'):
            value,errors=a.request_json(req)
        self.assertTrue(value['ok']);self.assertEqual(len(errors),1)
        self.assertIs(opener.call_args_list[0].args[0],opener.call_args_list[1].args[0])
    def test_non_retryable_http_error(self):
        with patch.object(a.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('https://example.invalid',400,'bad request',{},None)) as opener:
            with self.assertRaises(urllib.error.HTTPError):a.request_json(urllib.request.Request('https://example.invalid'))
        self.assertEqual(opener.call_count,1)
    def test_related_test_in_nested_directory(self):
        files={'astropy/nddata/mixins/tests/test_ndarithmetic.py':'','astropy/nddata/tests/test_nddata.py':''}
        self.assertEqual(a.related_tests(files,['astropy/nddata/mixins/ndarithmetic.py'])[0],'astropy/nddata/mixins/tests/test_ndarithmetic.py')
    def test_related_test_prefers_target_subsystem_over_issue_vocabulary(self):
        files={
            'coordinates/tests/test_sky_coordinate.py':'class TestSkyCoordinate: pass\n',
            'table/tests/test_table.py':'def test_attribute_message(): pass\n',
        }
        self.assertEqual(a.related_tests(files,['coordinates/sky_coordinate.py'],'attribute access message')[0],
                         'coordinates/tests/test_sky_coordinate.py')
    def test_root_level_tests_are_allowed_but_not_editable(self):
        files={'django/db/backends/mysql/base.py':'x = 1\n','tests/backends/mysql/test_creation.py':''}
        self.assertEqual(a.related_tests(files,['django/db/backends/mysql/base.py'])[0],'tests/backends/mysql/test_creation.py')
        with self.assertRaises(ValueError):a.apply_edits(files,{'tests/backends/mysql/test_creation.py':['']},[{'path':'tests/backends/mysql/test_creation.py','old':'x','new':'y'}])
    def test_linked_source_paths_expand_rare_code_literals(self):
        files={'django/db/backends/mysql/base.py':"kwargs['passwd'] = value\n",'django/db/backends/mysql/client.py':"opts.get('passwd')\n",'django/other.py':'unrelated\n','tests/test_mysql.py':"'passwd'\n"}
        paths,literals=a.linked_source_paths('Replace "passwd" with "password" in django/db/backends/mysql/base.py.',files)
        self.assertIn('django/db/backends/mysql/base.py',paths)
        self.assertIn('django/db/backends/mysql/client.py',paths)
        self.assertNotIn('tests/test_mysql.py',paths)
        self.assertEqual(literals,['passwd','password'])
    def test_linked_source_paths_extract_calls_and_single_quotes(self):
        files={'sympy/utilities/lambdify.py':'def lambdify():\n    pass\n','sympy/printing/pycode.py':'class MpmathPrinter:\n    pass\n','sympy/solvers/solvers.py':'def nsolve():\n    pass\n','sympy/noise.py':'nsolve mentioned\n'}
        paths,literals=a.linked_source_paths("lambdify(x, expr, 'mpmath') gives reduced precision in nsolve(expr)",files)
        self.assertIn('lambdify',literals);self.assertIn('mpmath',literals);self.assertIn('nsolve',literals)
        self.assertEqual(paths[0],'sympy/utilities/lambdify.py')
    def test_migration_pairs_and_remaining_occurrences(self):
        issue='deprecated "db" and "passwd" kwargs in favor of "database" and "password" respectively'
        pairs=a.migration_pairs(issue)
        self.assertEqual(pairs,[('db','database'),('passwd','password')])
        rows=a.remaining_migration_occurrences({'pkg/base.py':"x['db'] = 1\n",'pkg/client.py':"x.get('passwd')\n",'tests/test_x.py':"x['db']\n"},pairs)
        self.assertEqual([row['path'] for row in rows],['pkg/base.py','pkg/client.py'])
        coverage=a.unresolved_migration_coverage({'pkg/base.py':"x['db']; x['database']\n",'pkg/client.py':"x.get('passwd')\n",'tests/test_x.py':"x['db']\n"},pairs)
        self.assertEqual(coverage,[{'path':'pkg/client.py','old':'passwd','new':'password'}])
    def test_repeated_text_requires_location(self):
        source='x = 1\ny = 2\nx = 1\n';files={'a.py':source};visible={'a.py':[source]}
        with self.assertRaises(ValueError):a.apply_edits(files,visible,[{'path':'a.py','old':'x = 1','new':'x = 3'}])
        result=a.apply_edits(files,visible,[{'path':'a.py','old':'x = 1','new':'x = 3','start':3}])
        self.assertEqual(result['a.py'],'x = 1\ny = 2\nx = 3\n')
    def test_unseen_edits_rejected(self):
        with self.assertRaises(ValueError):a.apply_edits({'a.py':'x = 1\n'},{},[{'path':'a.py','old':'x = 1','new':'x = 2'}])
    def test_target_typeerror_can_validate(self):
        b={'compile':{'exit_code':0},'probe':{'exit_code':1,'stderr':'TypeError: target bug'},'regression':{'exit_code':1,'cases':3,'failures':['existing']}}
        c={'compile':{'exit_code':0},'probe':{'exit_code':0},'regression':{'exit_code':1,'cases':3,'failures':['existing']}}
        self.assertTrue(a.classify(b,c)['accepted'])
        c['regression']['failures'].append('new')
        self.assertEqual(a.classify(b,c)['status'],'new_regression')
    def test_non_discriminating_probe_and_empty_tests_rejected(self):
        b={'compile':{'exit_code':0},'probe':{'exit_code':0},'regression':{'exit_code':0,'cases':3,'failures':[]}}
        self.assertFalse(a.classify(b,b)['accepted'])
        b['probe']['exit_code']=1;c={**b,'probe':{'exit_code':0},'regression':{'exit_code':5,'cases':0}}
        self.assertFalse(a.classify(b,c)['accepted'])
    def test_failure_signal_routes_hard_failures(self):
        self.assertTrue(a.is_failure_signal({'verdict':{'status':'syntax_error'}}))
        self.assertTrue(a.is_failure_signal({'verdict':{'candidate_passed':False}}))
        self.assertTrue(a.is_failure_signal({'verdict':{'status':'new_regression'}}))
        self.assertFalse(a.is_failure_signal({'verdict':{'status':'needs_validation','candidate_passed':True}}))
    def test_failure_guidance_is_specific(self):
        self.assertIn('syntax/edit error',a.failure_guidance({'verdict':{'status':'syntax_error'}}))
        self.assertIn('behavior still fails',a.failure_guidance({'verdict':{'candidate_passed':False}}))
        self.assertIn('test selection/infra',a.failure_guidance({'verdict':{'regression_tests_valid':False}}))
        self.assertIn('non-discriminating',a.failure_guidance({'has_assertions':False,'verdict':{}}))

if __name__=='__main__':unittest.main()

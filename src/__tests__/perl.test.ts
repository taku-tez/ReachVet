/**
 * ReachVet - Perl Language Support Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSource, findModuleUsages, getModulesForDist, isCoreModule } from '../languages/perl/parser.js';
import { parseCpanfile, parseMetaJson, parseMakefilePL, getPerlVersion } from '../languages/perl/cpanfile.js';
import { PerlAdapter } from '../languages/perl/index.js';

describe('Perl Parser', () => {
  describe('parseSource', () => {
    it('should parse use statements', () => {
      const code = `
use strict;
use warnings;
use Mojolicious;
use DBI;

package MyApp;
`;
      const imports = parseSource(code, 'MyApp.pm');
      
      expect(imports).toHaveLength(4);
      expect(imports[0].moduleName).toBe('strict');
      expect(imports[0].importStyle).toBe('use');
      expect(imports[2].moduleName).toBe('Mojolicious');
      expect(imports[3].moduleName).toBe('DBI');
    });

    it('should parse use with qw()', () => {
      const code = `
use Exporter qw(import);
use List::MoreUtils qw(any all none);
`;
      const imports = parseSource(code, 'MyApp.pm');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].imports).toContain('import');
      expect(imports[1].imports).toContain('any');
      expect(imports[1].imports).toContain('all');
      expect(imports[1].imports).toContain('none');
    });

    it('should parse use with empty parens', () => {
      const code = `
use DBI ();
use JSON::XS ();
`;
      const imports = parseSource(code, 'MyApp.pm');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].noImport).toBe(true);
      expect(imports[1].noImport).toBe(true);
    });

    it('should parse require statements', () => {
      const code = `
require Mojolicious;
require Some::Module;
`;
      const imports = parseSource(code, 'MyApp.pm');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('require');
      expect(imports[0].noImport).toBe(true);
    });

    it('should parse use parent', () => {
      const code = `
use parent 'Mojolicious';
use parent qw(Class::A Class::B);
`;
      const imports = parseSource(code, 'MyApp.pm');
      
      expect(imports).toHaveLength(3);
      expect(imports[0].importStyle).toBe('parent');
      expect(imports[0].moduleName).toBe('Mojolicious');
      expect(imports[1].moduleName).toBe('Class::A');
      expect(imports[2].moduleName).toBe('Class::B');
    });

    it('should parse use base', () => {
      const code = `
use base 'Exporter';
use base qw(Parent1 Parent2);
`;
      const imports = parseSource(code, 'MyApp.pm');
      
      expect(imports).toHaveLength(3);
      expect(imports[0].importStyle).toBe('base');
    });
  });

  describe('findModuleUsages', () => {
    it('should find OO method calls', () => {
      const code = `
my $ua = LWP::UserAgent->new();
my $res = $ua->get('http://example.com');
my $dbh = DBI->connect('dbi:Pg:', '', '');
`;
      const usages = findModuleUsages(code, ['LWP::UserAgent', 'DBI'], 'script.pl');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
      expect(usages.find(u => u.identifier === 'LWP::UserAgent')).toBeDefined();
      expect(usages.find(u => u.identifier === 'DBI')).toBeDefined();
    });

    it('should find function calls', () => {
      const code = `
my $json = JSON::XS::encode_json($data);
my $decoded = JSON::XS::decode_json($string);
`;
      const usages = findModuleUsages(code, ['JSON::XS'], 'script.pl');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getModulesForDist', () => {
    it('should return known mappings', () => {
      expect(getModulesForDist('Mojolicious')).toContain('Mojolicious');
      expect(getModulesForDist('DBI')).toContain('DBI');
      expect(getModulesForDist('JSON-XS')).toContain('JSON::XS');
    });

    it('should infer from distribution name', () => {
      const modules = getModulesForDist('Some-Module');
      expect(modules).toContain('Some::Module');
    });
  });

  describe('isCoreModule', () => {
    it('should identify core modules', () => {
      expect(isCoreModule('strict')).toBe(true);
      expect(isCoreModule('warnings')).toBe(true);
      expect(isCoreModule('Carp')).toBe(true);
      expect(isCoreModule('File::Spec')).toBe(true);
    });

    it('should not flag CPAN modules', () => {
      expect(isCoreModule('Mojolicious')).toBe(false);
      expect(isCoreModule('DBI')).toBe(false);
      expect(isCoreModule('JSON::XS')).toBe(false);
    });
  });
});

describe('cpanfile Parser', () => {
  describe('parseCpanfile', () => {
    it('should parse runtime dependencies', () => {
      const content = `
requires 'Mojolicious', '9.0';
requires 'DBI';
recommends 'JSON::XS', '4.0';
`;
      const deps = parseCpanfile(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('Mojolicious');
      expect(deps[0].version).toBe('9.0');
      expect(deps[0].phase).toBe('runtime');
      expect(deps[0].relationship).toBe('requires');
      expect(deps[2].relationship).toBe('recommends');
    });

    it('should parse phase-specific dependencies', () => {
      const content = `
requires 'Mojolicious';

on 'test' => sub {
    requires 'Test::More';
    requires 'Test::Deep';
};

on 'develop' => sub {
    requires 'Perl::Critic';
};
`;
      const deps = parseCpanfile(content);
      
      expect(deps).toHaveLength(4);
      expect(deps.find(d => d.name === 'Test::More')?.phase).toBe('test');
      expect(deps.find(d => d.name === 'Perl::Critic')?.phase).toBe('develop');
    });
  });

  describe('parseMetaJson', () => {
    it('should parse META.json prereqs', () => {
      const content = JSON.stringify({
        name: 'My-App',
        prereqs: {
          runtime: {
            requires: {
              'Mojolicious': '9.0',
              'DBI': '1.0'
            }
          },
          test: {
            requires: {
              'Test::More': '0'
            }
          }
        }
      });
      
      const deps = parseMetaJson(content);
      
      expect(deps).toHaveLength(3);
      expect(deps.find(d => d.name === 'Mojolicious')?.phase).toBe('runtime');
      expect(deps.find(d => d.name === 'Test::More')?.phase).toBe('test');
    });
  });

  describe('parseMakefilePL', () => {
    it('should parse PREREQ_PM', () => {
      const content = `
use ExtUtils::MakeMaker;

WriteMakefile(
    NAME => 'My::App',
    PREREQ_PM => {
        'Mojolicious' => '9.0',
        'DBI' => '1.0',
    },
    TEST_REQUIRES => {
        'Test::More' => '0',
    },
);
`;
      const deps = parseMakefilePL(content);
      
      expect(deps).toHaveLength(3);
      expect(deps.find(d => d.name === 'Mojolicious')?.phase).toBe('runtime');
      expect(deps.find(d => d.name === 'Test::More')?.phase).toBe('test');
    });
  });

  describe('getPerlVersion', () => {
    it('should extract Perl version from cpanfile', () => {
      const content = `requires 'perl', '5.016';`;
      expect(getPerlVersion(content)).toBe('5.016');
    });
  });
});

describe('PerlAdapter', () => {
  const adapter = new PerlAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('perl');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.pl');
    expect(adapter.fileExtensions).toContain('.pm');
    expect(adapter.fileExtensions).toContain('.t');
  });
});

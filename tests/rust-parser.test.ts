/**
 * ReachVet - Rust Parser Tests (Unsafe Detection)
 */

import { describe, it, expect } from 'vitest';
import { detectUnsafeCode } from '../src/languages/rust/parser.js';

describe('detectUnsafeCode', () => {
  it('should detect unsafe blocks', () => {
    const source = `
fn main() {
    unsafe {
        let ptr = 0x1234 as *const i32;
        println!("{}", *ptr);
    }
}
`;
    const warnings = detectUnsafeCode(source, 'main.rs');
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('unsafe_block');
  });

  it('should detect unsafe fn', () => {
    const source = `
unsafe fn dangerous() {
    // do something dangerous
}
`;
    const warnings = detectUnsafeCode(source, 'main.rs');
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('unsafe_fn');
  });

  it('should detect unsafe impl', () => {
    const source = `
unsafe impl Send for MyType {}
`;
    const warnings = detectUnsafeCode(source, 'main.rs');
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('unsafe_impl');
  });

  it('should detect unsafe trait', () => {
    const source = `
unsafe trait MyTrait {
    fn do_something(&self);
}
`;
    const warnings = detectUnsafeCode(source, 'main.rs');
    
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('unsafe_trait');
  });

  it('should not warn for safe code', () => {
    const source = `
fn main() {
    let x = 42;
    println!("{}", x);
}
`;
    const warnings = detectUnsafeCode(source, 'main.rs');
    
    expect(warnings).toHaveLength(0);
  });
});

import '@testing-library/jest-dom'
import 'jest-styled-components'

global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))

jest.mock('@floating-ui/react', () => {
  const actual = jest.requireActual('@floating-ui/react')
  return {
    ...actual,
    useFloating: (options = {}) => {
      const { placement = 'bottom-start' } = options
      const result = actual.useFloating(options)
      return { ...result, placement }
    },
  }
})

import axios from 'axios'

import config from '~/config'

import { make256key } from '~/utils'

export const strict = false

const IP_REGEX = RegExp(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]):[0-9]+$/)

export const state = () => ({
  user: null,
  userDeals: [],
  account: null,
  liquidityPositions: [],

  markets: [],
  network: {},

  baseUrl: '',
  tokens: [],
  ibcTokens: ['eth.token'],
  ibcAccepts: []
})

export const mutations = {
  setNetwork: (state, network) => {
    state.network = network
  },

  setUser: (state, user) => state.user = user,
  setMarkets: (state, markets) => state.markets = markets,
  setUserDeals: (state, deals) => state.userDeals = deals,
  setLiquidityPositions: (state, positions) => state.liquidityPositions = positions,

  setBaseUrl: (state, url) => state.baseUrl = url,
  setLoading: (state, loading) => state.loading = loading,
  setTokens: (state, tokens) => state.tokens = tokens,
  setAccount: (state, account) => state.account = account
}

export const actions = {
  init({ dispatch, state, getters }) {
    dispatch('fetchTokens')

    //setInterval(() => dispatch('market/fetchOrders', {}, { root: true }), 10000)

    if (state.network.name == 'local') return

    dispatch('loadMarkets')
    // dispatch('loadIbc') TODO Remove BOS IBC LOGIC

    setInterval(() => dispatch('update'), 15000)

    this.$socket.on('connect_error', (err) => {
      console.log(`websocket connect_error due to ${err.message}`)
    })

    // TODO Move push notifications to other place
    this.$socket.on('match', match => {
      const market = getters.markets.filter(m => m.id == match.market_id)[0]

      if (match.bid) {
        this._vm.$notify({
          title: `Order match - ${market.symbol}`,
          message: `${match.bid} ${market.base_token.symbol.name} at ${match.price}`,
          type: 'success'
        })
      } else {
        this._vm.$notify({
          title: `Order match - ${market.symbol}`,
          message: `${match.ask} ${market.base_token.symbol.name} at ${match.price}`,
          type: 'success'
        })
      }
    })
  },

  toggleTheme({ state, commit }) {
    this.$colorMode.preference = this.$colorMode.preference !== 'dark' ? 'dark' : 'light'
  },

  async fetchTokens({ commit }) {
    const { data: tokens } = await this.$axios.get('https://raw.githubusercontent.com/eoscafe/eos-airdrops/master/tokens.json')

    commit('setTokens', tokens)
  },

  update({ dispatch }) {
    dispatch('loadUserBalances')
    dispatch('market/loadUserOrders')
    dispatch('loadAccountData')
  },

  async loadAccountData({ state, commit, getters, dispatch }) {
    if (!state.user) return

    const account = await this.$rpc.get_account(state.user.name)
    commit('setAccount', account)
  },

  async loadMarkets({ state, commit, getters, dispatch }) {
    const { data } = await this.$axios.get('/markets')
    data.map(m => {
      const { base_token, quote_token } = m

      m.symbol = quote_token.symbol.name + ' / ' + base_token.symbol.name
      m.slug = (quote_token.str + '_' + base_token.str).toLowerCase().replace(/@/g, '-')

      m.i256 = make256key(base_token.contract, base_token.symbol.name, quote_token.contract, quote_token.symbol.name)
    })
    commit('setMarkets', data)
  },

  async loadIbc({ state, commit, rootGetters }) {
    const { rows: ibcTokens } = await this.$rpc.get_table_rows({
      code: 'bosibc.io',
      scope: 'bosibc.io',
      table: 'accepts',
      limit: 1000
    })

    const tokens = [...new Set([...state.ibcTokens, ...ibcTokens.map(t => t.original_contract)])]

    commit('setIbcTokens', tokens)
    commit('setIbcAccepts', ibcTokens)
  },

  loadUserLiqudityPositions({ state, commit }) {
    this.$axios.get(`/account/${state.user.name}/liquidity_positions`).then(r => {
      commit('setLiquidityPositions', r.data)
    })
  },

  loadUserBalances({ rootState, state, commit }) {
    if (state.user) {
      // TODO Вынести этот эндпоинт в конфиг
      //this.$axios.get(`${state.network.lightapi}/api/balances/${state.network.name}/${rootState.user.name}`).then((r) => {
      // FIXME Почему то нукстовский аксиос не работает для телефонов
      axios.get(`${state.network.lightapi}/api/balances/${state.network.name}/${rootState.user.name}`).then((r) => {
        const balances = r.data.balances.filter(b => parseFloat(b.amount) > 0)
        balances.sort((a, b) => {
          if (a.contract == 'eosio.token' || b.contract == 'eosio.token') { return -1 }

          if (a.currency < b.currency) { return -1 }
          if (a.currency > b.currency) { return 1 }

          return 0
        })

        balances.map(b => b.id = b.currency + '@' + b.contract)

        commit('setUser', { ...state.user, balances }, { root: true })
      }).catch(e => console.log('balances: ', e))
    }
  },

  async fetchUserDeals({ state, commit }) {
    if (!state.user) return

    const { data: deals } = await this.$axios.get(`/account/${state.user.name}/deals`)
    commit('setUserDeals', deals)
  }
}

export const getters = {
  markets(state) {
    return state.markets
  },

  user(state) {
    return state.user
  },

  systemBalance(state) {
    const { symbol, contract } = state.network.baseToken

    if (state.user && state.user.balances) {
      const systemBalance = state.user.balances.filter(b => {
        return b.currency === symbol && b.contract === contract
      })[0]

      if (systemBalance) return parseFloat(systemBalance.amount).toFixed(4) + ' ' + symbol
    }

    return `0.0000 ${symbol}`
  },

  knownTokens(state) {
    const tokens = []

    state.markets.map(m => {
      tokens.push(m.quote_token)
    })

    return tokens
  }
}

const { mergeDeepRight } = require('ramda')
const shortid = require('shortid')
const aws = require('aws-sdk')
const { Component } = require('@serverless/core')

/**
 * AwsIamPolicy
 * @extends Component
 */

class AwsIamPolicy extends Component {
  /**
   * Default
   * @param  {Object}  [inputs={}] [description]
   * @return {Promise}             [description]
   */

  async default(inputs = {}) {
    this.context.status(`Deploying`)

    // Defaults
    const defaults = {}
    defaults.region = 'us-east-1'
    defaults.policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['iam:GetPolicyVersion'],
          Resource: '*'
        }
      ]
    }
    defaults.name = `policy-${shortid.generate()}`
    defaults.description = 'A policy created by Serverless Components'
    defaults.path = '/'

    inputs = mergeDeepRight(defaults, inputs)

    // Ensure Document is a string
    inputs.policy =
      typeof inputs.policy === 'string' ? inputs.policy : JSON.stringify(inputs.policy)

    const iam = new aws.IAM({
      region: inputs.region || this.context.region,
      credentials: this.context.credentials.aws
    })

    const params = {
      PolicyDocument: inputs.policy,
      PolicyName: inputs.name,
      Description: inputs.description,
      Path: inputs.path
    }

    let result
    try {
      result = await iam.createPolicy(params).promise()
    } catch (error) {
      throw new Error(error)
    }

    // Save state and set outputs
    const outputs = {}
    this.state.name = outputs.name = result.Policy.PolicyName
    this.state.id = outputs.id = result.Policy.PolicyId
    this.state.arn = outputs.arn = result.Policy.Arn
    this.state.version = outputs.version = 'v1'
    this.state.policy = outputs.policy = JSON.parse(inputs.policy)
    await this.save()

    return outputs
  }

  /**
   * Remove
   * @param  {Object}  [inputs={}]
   * @return {Promise}
   */

  async remove(inputs = {}) {
    if (!this.state.arn) return {}

    const iam = new aws.IAM({
      region: inputs.region,
      credentials: this.context.credentials.aws
    })

    const params = {
      PolicyArn: this.state.arn
    }

    let result
    try {
      result = await iam.deletePolicy(params).promise()
    } catch (error) {
      if (!error.message.includes('does not exist')) throw new Error(error)
    }

    // Clear state
    this.state = {}
    await this.save()

    return {}
  }
}

module.exports = AwsIamPolicy

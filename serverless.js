const { equals, mergeDeepRight, pick } = require('ramda')
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

  async default(initialInputs = {}) {
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

    const inputs = mergeDeepRight(this.state, mergeDeepRight(defaults, initialInputs))

    // Ensure Document is a string
    inputs.policy =
      typeof inputs.policy === 'string' ? inputs.policy : JSON.stringify(inputs.policy)

    // Check if policy exists
    const iam = new aws.IAM({
      region: inputs.region || this.context.region,
      credentials: this.context.credentials.aws
    })

    // Do old policy cleanup
    if (this.state.lastPolicyArn) {
      const params = {
        PolicyArn: this.state.lastPolicyArn
      }

      try {
        this.context.debug(`Deleting old policy for ${inputs.name} ${params.PolicyArn}`)
        await iam.deletePolicy(params).promise()
      } catch (error) {
        this.context.debug(`Could not delete old policy ${inputs.name} ${params.PolicyArn}`)
        this.context.debug(error)
        this.state.lastPolicyArn = undefined
      }
    }

    let result
    // If a new policy is required attempt to delete the old one
    if (inputs.arn && initialInputs.name && initialInputs.name !== this.state.name) {
      this.context.debug(`New policy required for ${inputs.name}`)

      const params = {
        PolicyArn: inputs.arn
      }

      try {
        this.context.debug(`Deleting old policy for ${inputs.name} ${params.PolicyArn}`)
        await iam.deletePolicy(params).promise()
      } catch (error) {
        this.context.debug(
          `Could not delete old policy ${inputs.name} ${params.PolicyArn}. Old policy ${inputs.arn} will be attempted next run`
        )
        this.context.debug(error)
        this.state.lastPolicyArn = this.state.arn
      }

      inputs.name = initialInputs.name
      result = undefined
    }
    // Check policy and destroy it if changes are needed
    else if (inputs.arn) {
      try {
        const params = {
          PolicyArn: inputs.arn
        }

        const { Policy: policy } = await iam.getPolicy(params).promise()
        const policyVersion = await iam
          .getPolicyVersion({
            ...params,
            VersionId: policy.DefaultVersionId
          })
          .promise()

        result = {
          ...policyVersion,
          ...policy,
          Document: decodeURI(policyVersion.Document)
        }
      } catch (error) {
        this.context.debug(`Could not fetch current policy ${inputs.name} ${inputs.arn}`)
        this.context.debug(error)
        result = undefined
      }
    }

    if (result && JSON.stringify(this.state.policy) !== inputs.policy) {
      this.context.debug(`Creating new policy version ${inputs.name}`)
      // Create a new policy version
      if (inputs.policy) {
        const params = {
          PolicyArn: result.Arn,
          PolicyDocument: inputs.policy,
          SetAsDefault: true
        }

        try {
          const policyVersion = await iam
            .createPolicyVersion(params)
            .promise()
            .then(({ PolicyVersion }) => PolicyVersion)

          result = {
            ...policyVersion,
            ...result
          }
        } catch (error) {
          this.context.debug(`Could not create policy ${inputs.name} - ${inputs.arn} version`)
          this.context.debug(error)
          result = undefined
        }
      }
      // Delete oldest policy version
      if (result.VersionId) {
        const params = {
          PolicyArn: result.Arn,
          VersionId: result.VersionId
        }
        try {
          await iam.deletePolicyVersion(params).promise()
        } catch (error) {
          this.context.debug(
            `Could not delete policy ${params.PolicyArn} version ${params.VersionId}`
          )
          this.context.debug(error)
        }
      }
    }

    // Generate new policy
    if (!result) {
      this.context.log(`Creating new policy ${inputs.name}`)
      const params = {
        PolicyDocument: inputs.policy,
        PolicyName: inputs.name,
        Description: inputs.description,
        Path: inputs.path
      }

      try {
        result = await iam
          .createPolicy(params)
          .promise()
          .then(({ Policy }) => Policy)
      } catch (error) {
        throw new Error(error)
      }
    } else {
      this.context.debug(`No policy changes required for ${inputs.name}`)
    }

    // Save state and set outputs
    const {
      PolicyName: name,
      PolicyId: id,
      Arn: arn,
      VersionId: version = 'v1',
      Path: path
    } = result
    const outputs = {
      id,
      name,
      arn,
      version,
      policy: JSON.parse(inputs.policy),
      path
    }
    this.state.id = id
    this.state.name = name
    this.state.arn = arn
    this.state.path = path
    this.state.version = version
    this.state.policy = outputs.policy

    if (this.state.lastPolicyArn) {
      outputs.lastPolicyArn = this.state.lastPolicyArn
    }

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
    await this.save({})

    return {}
  }
}

module.exports = AwsIamPolicy

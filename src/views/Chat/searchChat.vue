<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { NAutoComplete, NButton, NInput } from 'naive-ui';
import html2canvas from 'html2canvas';
import { Message } from './components';
import { useScroll } from './hooks/useScroll';
import { useChat } from './hooks/useChat';
import { useCopyCode } from './hooks/useCopyCode';
import { useUsingContext } from './hooks/useUsingContext';
import { HoverButton, SvgIcon } from '@/components/common';
import { useBasicLayout } from '@/hooks/useBasicLayout';
import { useChatStore, usePromptStore } from '@/store';
import { fetchChatAPIProcess } from '@/api';
import { t } from '@/locales';
import { message, Modal } from 'ant-design-vue';

let controller = new AbortController()

const props = defineProps({
	keyWorld: {
		type: String,
		default: ''
	},

	mobile: {
		type: Boolean,
		default: false
	}
})



const openLongReply = import.meta.env.VITE_GLOB_OPEN_LONG_REPLY === 'true'

const route = useRoute()

const router = useRouter()


const chatStore = useChatStore()

useCopyCode()

const { isMobile } = useBasicLayout()
const { addChat, updateChat, updateChatSome, getChatByUuidAndIndex } = useChat()
const { scrollRef, scrollToBottom } = useScroll()
const { usingContext, toggleUsingContext } = useUsingContext()

const { uuid } = route.params as { uuid: string }

const dataSources = computed(() => chatStore.getChatByUuid(+uuid))

const conversationList = computed(() => dataSources.value.filter(item => (!item.inversion && !item.error)))

const prompt = ref<string>('')
const loading = ref<boolean>(false)

const isAgain = ref(true) // 当前消息过多是否重新发起请求

const currentInfo = ref('') // 保存当前的查询条件，给重新调用使用

// 添加PromptStore
const promptStore = usePromptStore()
// 使用storeToRefs，保证store修改后，联想部分能够重新渲染
const { promptList: promptTemplate } = storeToRefs<any>(promptStore)

function handleSubmit(id = 0) {
	onConversation(id)
}

async function onConversation(againId = 0) {

	let message = prompt.value
	if (loading.value)
		return

	if (!message || message.trim() === '')
		return

	controller = new AbortController()

	const id = againId || +uuid

	currentInfo.value = message



	addChat(
		id,
		{
			dateTime: new Date().toLocaleString(),
			text: message,
			inversion: true,
			error: false,
			conversationOptions: null,
			requestOptions: { prompt: message, options: null },
		},
	)
	scrollToBottom()

	loading.value = true
	prompt.value = ''

	let options: Chat.ConversationRequest = {}
	const lastContext = conversationList.value[conversationList.value.length - 1]?.conversationOptions

	if (lastContext && usingContext.value)
		options = { ...lastContext }

	addChat(
		id,
		{
			dateTime: new Date().toLocaleString(),
			text: '',
			loading: true,
			inversion: false,
			error: false,
			conversationOptions: null,
			requestOptions: { prompt: message, options: { ...options } },
		},
	)
	scrollToBottom()

	try {
		let lastText = ''
		const fetchChatAPIOnce = async () => {

			await fetchChatAPIProcess<Chat.ConversationResponse>({
				prompt: message,
				options,
				signal: controller.signal,
				onDownloadProgress: ({ event }) => {

					const xhr = event.target

					const { responseText } = xhr
					const lastIndex = responseText.lastIndexOf(' ')

					let chunk: string = ''
					if (lastIndex !== -1)
						chunk = JSON.parse(responseText.substring(lastIndex).includes('DONE') ? null : responseText.substring(lastIndex))?.choices[0].delta.content
					lastText = lastText + (chunk ?? '')

					const data = { conversationId: '', id: '' }
					try {
						updateChat(
							id,
							dataSources.value.length - 1,
							{
								dateTime: new Date().toLocaleString(),
								text: lastText,
								inversion: false,
								error: false,
								loading: false,
								conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
								requestOptions: { prompt: message, options: { ...options } },
							},
						)

						if (openLongReply && data.detail.choices[0].finish_reason === 'length') {
							options.parentMessageId = data.id
							lastText = data.text
							message = ''
							return fetchChatAPIOnce()
						}

						scrollToBottom()
					}
					catch (error) {
						//
					}
				},
			})
		}

		await fetchChatAPIOnce()
		isAgain.value = true
	}
	catch (error: any) {
		if (error?.message?.indexOf('maximum context length') > -1 && isAgain.value) {
			// if (error?.message?.indexOf('request to https://api') > -1 && isAgain.value) {
			loading.value = false
			isAgain.value = false
			const pathName = router.currentRoute.value.name // 根据路由名称判断是否为门户页面或者聊天页面
			if (pathName == 'supconSearch') {
				chatStore.clearChatByUuid(+uuid)
				prompt.value = props.keyWorld
				handleSubmit()
			} else if (pathName == 'Chat') {
				const newId = Date.now()
				chatStore.addHistory({ title: '新会话', uuid: newId, isEdit: false })
				prompt.value = currentInfo.value
				handleSubmit(newId)
			}
			// return
		}
		const errorMessage = error?.message ?? t('common.wrong')

		if (error.message === 'canceled') {
			updateChatSome(
				+uuid,
				dataSources.value.length - 1,
				{
					loading: false,
				},
			)
			scrollToBottom()
			return
		}

		const currentChat = getChatByUuidAndIndex(+uuid, dataSources.value.length - 1)

		if (currentChat?.text && currentChat.text !== '') {
			updateChatSome(
				+uuid,
				dataSources.value.length - 1,
				{
					text: `${currentChat.text}\n[${errorMessage}]`,
					error: false,
					loading: false,
				},
			)
			return
		}

		updateChat(
			+uuid,
			dataSources.value.length - 1,
			{
				dateTime: new Date().toLocaleString(),
				text: errorMessage,
				inversion: false,
				error: true,
				loading: false,
				conversationOptions: null,
				requestOptions: { prompt: message, options: { ...options } },
			},
		)
		scrollToBottom()
	}
	finally {
		loading.value = false
	}
}

async function onRegenerate(index: number) {
	if (loading.value)
		return

	controller = new AbortController()

	const { requestOptions } = dataSources.value[index]

	let message = requestOptions?.prompt ?? ''

	let options: Chat.ConversationRequest = {}

	if (requestOptions.options)
		options = { ...requestOptions.options }

	loading.value = true

	updateChat(
		+uuid,
		index,
		{
			dateTime: new Date().toLocaleString(),
			text: '',
			inversion: false,
			error: false,
			loading: true,
			conversationOptions: null,
			requestOptions: { prompt: message, ...options },
		},
	)

	try {
		let lastText = ''
		const fetchChatAPIOnce = async () => {
			await fetchChatAPIProcess<Chat.ConversationResponse>({
				prompt: message,
				options,
				signal: controller.signal,
				onDownloadProgress: ({ event }) => {
					const xhr = event.target
					const { responseText } = xhr
					// Always process the final line
					const lastIndex = responseText.lastIndexOf('\n')
					let chunk = responseText
					if (lastIndex !== -1)
						chunk = responseText.substring(lastIndex)
					try {
						const data = JSON.parse(chunk)
						updateChat(
							+uuid,
							index,
							{
								dateTime: new Date().toLocaleString(),
								text: lastText + data.text ?? '',
								inversion: false,
								error: false,
								loading: false,
								conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
								requestOptions: { prompt: message, ...options },
							},
						)

						if (openLongReply && data.detail.choices[0].finish_reason === 'length') {
							options.parentMessageId = data.id
							lastText = data.text
							message = ''
							return fetchChatAPIOnce()
						}
					}
					catch (error) {
						//
					}
				},
			})
		}
		await fetchChatAPIOnce()
	}
	catch (error: any) {
		if (error.message === 'canceled') {
			updateChatSome(
				+uuid,
				index,
				{
					loading: false,
				},
			)
			return
		}

		const errorMessage = error?.message ?? t('common.wrong')

		updateChat(
			+uuid,
			index,
			{
				dateTime: new Date().toLocaleString(),
				text: errorMessage,
				inversion: false,
				error: true,
				loading: false,
				conversationOptions: null,
				requestOptions: { prompt: message, ...options },
			},
		)
	}
	finally {
		loading.value = false
	}
}

function handleExport() {
	if (loading.value)
		return
	Modal.confirm({
		title: '你想要下载记录吗？',
		onOk: async () => {
			try {
				// d.loading = true
				const ele = document.getElementById('image-wrapper')
				const canvas = await html2canvas(ele as HTMLDivElement, {
					useCORS: true,
				})
				const imgUrl = canvas.toDataURL('image/png')
				const tempLink = document.createElement('a')
				tempLink.style.display = 'none'
				tempLink.href = imgUrl
				tempLink.setAttribute('download', 'chat-shot.png')
				if (typeof tempLink.download === 'undefined')
					tempLink.setAttribute('target', '_blank')

				document.body.appendChild(tempLink)
				tempLink.click()
				document.body.removeChild(tempLink)
				window.URL.revokeObjectURL(imgUrl)
				message.success(t('chat.exportSuccess'))
				Promise.resolve()
			}
			catch (error: any) {
				message.error(t('chat.exportFailed'))
			}
			finally {
				// d.loading = false
			}
		},
	})

}

function handleDelete(index: number) {
	if (loading.value) return

	Modal.confirm({
		title: '你确定要删除这条记录吗？',
		onOk: () => chatStore.deleteChatByUuid(+uuid, index)
	})


	// dialog.warning({
	// 	title: t('chat.deleteMessage'),
	// 	content: t('chat.deleteMessageConfirm'),
	// 	positiveText: t('common.yes'),
	// 	negativeText: t('common.no'),
	// 	onPositiveClick: () => {
	// 	},
	// })
}

function handleClear() {
	if (loading.value) return

	Modal.confirm({
		title: '你确定要清空历史记录吗？',
		onOk: () => chatStore.clearChatByUuid(+uuid)
	})
	// dialog.warning({
	// 	title: t('chat.clearChat'),
	// 	content: t('chat.clearChatConfirm'),
	// 	positiveText: t('common.yes'),
	// 	negativeText: t('common.no'),
	// 	onPositiveClick: () => {
	// 	},
	// })
}

function handleEnter(event: KeyboardEvent) {
	if (!isMobile.value) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			handleSubmit()
		}
	}
	else {
		if (event.key === 'Enter' && event.ctrlKey) {
			event.preventDefault()
			handleSubmit()
		}
	}
}

function handleStop() {
	if (loading.value) {
		controller.abort()
		loading.value = false
	}
}

// 可优化部分
// 搜索选项计算，这里使用value作为索引项，所以当出现重复value时渲染异常(多项同时出现选中效果)
// 理想状态下其实应该是key作为索引项,但官方的renderOption会出现问题，所以就需要value反renderLabel实现
const searchOptions = computed(() => {
	if (prompt.value.startsWith('/')) {
		return promptTemplate.value.filter((item: { key: string }) => item.key.toLowerCase().includes(prompt.value.substring(1).toLowerCase())).map((obj: { value: any }) => {
			return {
				label: obj.value,
				value: obj.value,
			}
		})
	}
	else {
		return []
	}
})
// value反渲染key
const renderOption = (option: { label: string }) => {
	for (const i of promptTemplate.value) {
		if (i.value === option.label)
			return [i.key]
	}
	return []
}

const placeholder = computed(() => {
	if (isMobile.value)
		return t('chat.placeholderMobile')
	return t('chat.placeholder')
})

const buttonDisabled = computed(() => {
	return loading.value || !prompt.value || prompt.value.trim() === ''
})

// const footerClass = computed(() => {
// 	let classes = ['p-4']
// 	if (isMobile.value)
// 		classes = ['sticky', 'left-0', 'bottom-0', 'right-0', 'p-2', 'pr-3', 'overflow-hidden']
// 	return classes
// })

onMounted(() => {
	scrollToBottom();
});

onUnmounted(() => {
	if (loading.value) controller.abort();
})
</script>

<template>
	<div class="container">
		<main class="mainContainer">
			<div id="scrollRef" ref="scrollRef">
				<div id="image-wrapper" class="center">
					<template v-if="!dataSources.length">
						<div class="mainContainer_header">
							<SvgIcon icon="ri:bubble-chart-fill" class="mr-2 text-3xl" />
							<span>欢迎使用系统集成ChatGPT!</span>
						</div>
					</template>
					<template v-else>
						<div>
							<Message v-for="(item, index) of dataSources" :key="index" :date-time="item.dateTime" :text="item.text"
								:inversion="item.inversion" :error="item.error" :loading="item.loading" @regenerate="onRegenerate(index)"
								@delete="handleDelete(index)" />
							<div class="sticky bottom-0 left-0 flex justify-center">
								<NButton v-if="loading" type="warning" @click="handleStop">
									<template #icon>
										<SvgIcon icon="ri:stop-circle-line" />
									</template>
									Stop Responding
								</NButton>
							</div>
						</div>
					</template>
				</div>
			</div>
		</main>
		<footer class="footer">
			<div class="w-full max-w-screen-xl m-auto">
				<div class="fotter_svg">
					<HoverButton @click="handleClear">
						<span class="text-xl text-[#4f555e] dark:text-white">
							<SvgIcon v-if="!isMobile" icon="ri:delete-bin-line" />
							<van-icon v-else name="delete-o" />
						</span>
					</HoverButton>
					<HoverButton v-if="!isMobile" @click="handleExport">
						<span class="text-xl text-[#4f555e] dark:text-white">
							<SvgIcon icon="ri:download-2-line" />
						</span>
					</HoverButton>
					<!-- <HoverButton v-if="!isMobile" @click="toggleUsingContext">
						<span class="text-xl" :class="{ 'text-[#4b9e5f]': usingContext, 'text-[#a8071a]': !usingContext }">
							<SvgIcon icon="ri:chat-history-line" />
						</span>
					</HoverButton> -->
					<NAutoComplete v-model:value="prompt" :options="searchOptions" :render-label="renderOption">
						<template #default="{ handleInput, handleBlur, handleFocus }">
							<NInput v-model:value="prompt" type="textarea" :placeholder="placeholder"
								:autosize="{ minRows: 1, maxRows: isMobile ? 4 : 8 }" @input="handleInput" @focus="handleFocus"
								@blur="handleBlur" @keypress="handleEnter" />
						</template>
					</NAutoComplete>
					<NButton type="primary" :disabled="buttonDisabled" @click="handleSubmit(0)">
						<template #icon>
							<span class="dark:text-black">
								<SvgIcon v-if="!isMobile" icon="ri:send-plane-fill" />
								<van-icon v-else name="guide-o" />
							</span>
						</template>
					</NButton>
				</div>
			</div>
		</footer>
	</div>
</template>

<style lang="less" scoped>
.container {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: calc(100vh - 50px);
	background: white;
	padding: 2rem;
	background-image: url('../../assets/back.png');

}



.mainContainer {
	height: 90%;
	margin-bottom: 20px;

	overflow: scroll;

	&_header {
		width: 300px;
		margin: 0 auto;
		font-size: 20px;
		color: rgb(203, 203, 203);
	}
}

.fotter {
	display: flex;
	justify-content: center;
	align-items: center;

	&_svg {
		display: flex;
		gap: 4px;
		align-items: center;
	}
}

.flex-col {
	flex-direction: column;
}

.w-full {
	width: 100%;
}

.h-full {
	height: 100%;
}

.flex {
	display: flex;
}

.overflow-hidden {
	overflow: hidden;
}

.flex-1 {
	flex: 1 1 0%;
}

.p-4 {
	padding: 1rem;
}

.max-w-screen-xl {
	max-width: 1280px;
}

.m-auto {
	margin: auto;
}

.justify-center {
	justify-content: center;
}

.flex {
	display: flex;
}

.left-0 {
	left: 0px;
}

.bottom-0 {
	bottom: 0px;
}

.sticky {
	position: sticky;
}

.transition {
	transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
	transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
	transition-duration: 150ms;
}

.rounded-full {
	border-radius: 9999px;
}

.justify-center {
	justify-content: center;
}

.items-center {
	align-items: center;
}

.w-10 {
	width: 2.5rem;
}

.h-10 {
	height: 2.5rem;
}

.flex {
	display: flex;

}

.text-\[\#4b9e5f\] {
	--tw-text-opacity: 1;
	color: rgb(75 158 95 / var(--tw-text-opacity));
}

.text-\[\#4f555e\] {
	--tw-text-opacity: 1;
	color: rgb(79 85 94 / var(--tw-text-opacity));
}
</style>
